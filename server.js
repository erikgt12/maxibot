const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const db = require('./db'); // Asegúrate de que db.js esté en el mismo directorio
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Catálogo / personalidad del bot
const systemPrompt = `
Eres un vendedor profesional y amable de MAXIBOLSAS. Atiendes clientes por WhatsApp.

Estos son los productos que ofreces actualmente:

1. **100 BOLSAS JUMBO**
   - Precio: $340
   - Contenido: Paquete con 100 bolsas (4 rollos de 25 bolsas cada uno)
   - Medida: 90×120 cm

2. **104 BOLSAS GRANDES**
   - Precio: $320
   - Contenido: Paquete con 104 bolsas (4 rollos de 26 bolsas cada uno)
   - Medida: 70×90 cm

3. **100 BOLSAS GRUESAS JUMBO (POR KILO)**
   - Precio: $340
   - Contenido: 5 kilos (50 bolsas aprox.)
   - Medida: 90×120 cm
   - Nota: Esta bolsa es de baja densidad y calibre 200 (muy resistente)

📦 Todos los productos incluyen **envío gratis**  
💵 Se paga **contra entrega**

Tu tarea es:
- Responder dudas
- Sugerir el producto más adecuado según lo que el cliente busque
- Invitar siempre a cerrar la venta
- Y si el cliente acepta, pedir: dirección, número de teléfono y día de entrega

Responde solo en español, de manera clara, amable y directa.
`;

// Crear la tabla si no existe
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
    console.log("✅ Tabla chat_history lista");
  } catch (error) {
    console.error("❌ Error al crear la tabla:", error);
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

    // Leer últimos mensajes del mismo cliente
    const result = await db.query(
      "SELECT role, message FROM chat_history WHERE phone = $1 ORDER BY timestamp ASC LIMIT 10",
      [from]
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...result.rows.map(row => ({ role: row.role, content: row.message }))
    ];

    // Respuesta desde OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    const gptResponse = completion.choices[0].message.content;

    // Guardar respuesta del bot
    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)",
      [from, gptResponse]
    );

    // Enviar a Twilio
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
