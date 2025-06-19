// 📁 db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;


// 📁 server.js
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

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

app.post('/whatsapp-bot', async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Mensaje recibido:", incomingMsg);
  console.log("De:", from);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: incomingMsg }
      ],
    });

    const gptResponse = completion.choices[0].message.content;

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
  res.send("MAXIBOLSAS WhatsApp bot is running.");
});

app.listen(port, () => {
  console.log("Server running on port " + port);
});
