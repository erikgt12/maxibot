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

function detectarDatosEntrega(texto) {
  return texto.includes("calle") || texto.includes("colonia") || texto.includes("número") || /\d{10}/.test(texto);
}

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
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        producto TEXT NOT NULL,
        direccion TEXT,
        telefono TEXT,
        total NUMERIC(10,2),
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  try {
    await db.query("INSERT INTO chat_history (phone, role, message) VALUES ($1, 'user', $2)", [from, incomingMsg]);

    const result = await db.query("SELECT role, message FROM chat_history WHERE phone = $1 ORDER BY timestamp ASC LIMIT 10", [from]);
    const historial = result.rows;

    const productos = (await db.query("SELECT nombre, descripcion, precio FROM productos")).rows;

    const pedidoExistente = (await db.query("SELECT * FROM pedidos WHERE phone = $1 ORDER BY fecha DESC LIMIT 1", [from])).rows[0] || null;

    if (!pedidoExistente && detectarDatosEntrega(incomingMsg)) {
      const producto = productos[0]?.nombre || 'Producto';
      const precio = productos[0]?.precio || 0;
      await db.query(
        "INSERT INTO pedidos (phone, producto, direccion, telefono, total) VALUES ($1, $2, $3, $4, $5)",
        [from, producto, incomingMsg, incomingMsg.match(/\d{10}/)?.[0] || '', precio]
      );
    }

    const systemPrompt = `
Eres un vendedor amable y profesional de MAXIBOLSAS. Atiendes clientes por WhatsApp.
Todos los productos incluyen envío gratis y se pagan contra entrega.
Responde en mensajes breves, claros y sólo en español.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...historial.map(row => ({ role: row.role, content: row.message }))
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    const gptResponse = completion.choices[0]?.message?.content?.trim() || "¡Hola! ¿En qué puedo ayudarte con nuestras bolsas? ☺️";

    await db.query("INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)", [from, gptResponse]);

    const twiml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Message>${gptResponse}</Message>\n</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(twiml);

  } catch (error) {
    console.error("GPT error:", error);
    const fallback = "Ocurrió un error, pero estoy aquí para ayudarte. ¡Intenta enviar tu mensaje otra vez!";
    await db.query("INSERT INTO chat_history (phone, role, message) VALUES ($1, 'assistant', $2)", [from, fallback]);
    const twiml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Message>${fallback}</Message>\n</Response>`;
    res.set('Content-Type', 'text/xml');
    res.send(twiml);
  }
});

app.get("/", (req, res) => {
  res.send("MAXIBOLSAS WhatsApp bot is running ✅");
});

app.listen(port, () => {
  console.log("Server running on port " + port);
});
