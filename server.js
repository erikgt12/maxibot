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

// Prompt dinámico con catálogo
async function generarPromptConCatalogo() {
  const res = await db.query(`SELECT nombre, descripcion, precio FROM productos`);
  const lista = res.rows.map(p => `• ${p.nombre} - $${p.precio}\n${p.descripcion || ''}`).join('\n\n');

  return `
Eres un vendedor profesional, amable y claro de MAXIBOLSAS. Atiendes clientes por WhatsApp.

Estos son los productos que tienes disponibles actualmente:

${lista}

Todos incluyen envío gratis y se pagan contra entrega.

Tu tarea es:
- Sugerir el producto más adecuado según lo que el cliente busque
- Responder dudas de forma breve y útil
- Invitar a concretar la compra
- Pedir dirección, número de teléfono y día de entrega cuando el cliente acepte

⚠️ Mantén los mensajes intermedios cortos y concisos. Habla claro, directo y en español.

Tu estilo debe ser confiable, amable y orientado a cerrar ventas sin presionar.`.trim();
}

// Crear tablas e insertar productos
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
})();

app.post('/whatsapp-bot', async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Mensaje recibido:", incomingMsg);
  console.log("De:", from);

  try {
    // Guardar mensaje del usuario
    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'user', $2)",
      [from, incomingMsg]
    );

    // Leer historial reciente
    const result = await db.query(
      "SELECT role, message FROM chat_history WHERE phone = $1 ORDER BY timestamp ASC LIMIT 10",
      [from]
    );

    // Generar prompt dinámico con productos actuales
    const systemPrompt = await generarPromptConCatalogo();

    const messages = [
      { role: "system", content: systemPrompt },
      ...result.rows.map(row => ({ role: row.role, content: row.message }))
    ];

    // Obtener respuesta del modelo
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    const gptResponse = completion.choices[0].message.content;

    // Guardar respuesta
    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)",
      [from, gptResponse]
    );

    // Enviar respuesta a Twilio
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
