const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const db = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 🔁 Nuevo prompt
const systemPrompt = `
Eres un vendedor profesional, amable y claro de MAXIBOLSAS. Atiendes clientes por WhatsApp.

Ofreces diferentes tipos de bolsas de basura: grandes, jumbo, por kilo, resistentes y con envío gratis. El cliente paga contra entrega.

Tu tarea es:
- Responder dudas de forma breve y útil
- Sugerir el producto más adecuado según lo que el cliente busca
- Invitar a concretar la compra
- Pedir dirección, número de teléfono y día de entrega cuando el cliente acepte

⚠️ Mantén los mensajes intermedios cortos y concisos. No expliques de más. Habla claro, directo y en español.

Tu estilo debe ser confiable, amable y orientado a cerrar ventas sin presionar.
`;

// 🔍 Validación IA: dirección
async function direccionEsValidaConIA(texto) {
  const validacion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "Tu tarea es responder solo con 'sí' o 'no' si el siguiente mensaje contiene una dirección válida en México (debe tener calle y número al menos)."
      },
      {
        role: "user",
        content: texto
      }
    ]
  });

  const respuesta = validacion.choices[0].message.content.trim().toLowerCase();
  return respuesta === 'sí' || respuesta.startsWith('sí');
}

// Crear las tablas
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio NUMERIC(10,2) NOT NULL,
        stock INT DEFAULT 0,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      INSERT INTO productos (nombre, descripcion, precio, stock)
      VALUES 
        ('Bolsa negra jumbo', 'Paquete de 100 bolsas de 90×120 cm', 340, 50),
        ('Bolsa grande', 'Paquete de 104 bolsas de 70×90 cm', 320, 40),
        ('Bolsa gruesa por kilo', '5 kilos (~50 bolsas) de calibre 200, baja densidad', 340, 30)
      ON CONFLICT DO NOTHING;
    `);

    console.log("✅ Tablas listas y productos insertados");
  } catch (error) {
    console.error("❌ Error al preparar la base de datos:", error);
  }
});

// Función para buscar productos
async function buscarProductoPorTexto(texto) {
  const res = await db.query(
    `SELECT * FROM productos WHERE nombre ILIKE $1 OR descripcion ILIKE $1 LIMIT 1`,
    [`%${texto}%`]
  );
  return res.rows[0];
}

app.post('/whatsapp-bot', async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Mensaje recibido:", incomingMsg);
  console.log("De:", from);

  try {
    // Guardar mensaje
    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'user', $2)",
      [from, incomingMsg]
    );

    // ✅ Verificar si es una dirección
    if (incomingMsg.toLowerCase().includes("mi dirección") || incomingMsg.toLowerCase().includes("vivo en")) {
      const esValida = await direccionEsValidaConIA(incomingMsg);

      let respuesta = '';
      if (esValida) {
        respuesta = '¡Gracias! ¿Podrías decirme tu número de teléfono y el día que deseas recibir tu pedido?';
      } else {
        respuesta = 'Tu dirección parece incompleta. Por favor incluye calle, número y colonia para poder enviarte tu pedido.';
      }

      await db.query(
        "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)",
        [from, respuesta]
      );

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${respuesta}</Message>
</Response>`;
      res.set('Content-Type', 'text/xml');
      return res.send(twiml);
    }

    // 🔍 Consultar producto en base
    const producto = await buscarProductoPorTexto(incomingMsg);
    if (producto) {
      const respuesta = `Tenemos el producto "${producto.nombre}" por $${producto.precio}. ${producto.descripcion || ''} ¿Te gustaría que lo apartemos?`;

      await db.query(
        "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)",
        [from, respuesta]
      );

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${respuesta}</Message>
</Response>`;

      res.set('Content-Type', 'text/xml');
      return res.send(twiml);
    }

    // 🧠 Continuar con OpenAI normal
    const result = await db.query(
      "SELECT role, message FROM chat_history WHERE phone = $1 ORDER BY timestamp ASC LIMIT 10",
      [from]
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...result.rows.map(row => ({ role: row.role, content: row.message }))
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    const gptResponse = completion.choices[0].message.content;

    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)",
      [from, gptResponse]
    );

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${gptResponse}</Message>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(twiml);

  } catch (error) {
    console.error("GPT error:", error);
    res.status(500).send("Error interno");
  }
});

app.get("/", (req, res) => {
  res.send("MAXIBOLSAS WhatsApp bot is running con base de datos ✅");
});

app.listen(port, () => {
  console.log("Server running on port " + port);
});

