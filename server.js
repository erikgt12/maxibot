
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/whatsapp-bot', async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  const prompt = `
Eres un vendedor amable y directo de MAXIBOLSAS. Estás hablando por WhatsApp con un cliente interesado en comprar bolsas de basura negras calibre 200. 
Tu objetivo es cerrar la venta. Habla solo en español. Siempre ofrece:
- Precio por bulto: $799 (25kg)
- Envío gratis
- Pago contra entrega

Si el cliente está interesado, pídele:
1. Dirección completa
2. Número de teléfono
3. Día para la entrega

Mensaje del cliente: "${incomingMsg}"
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
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

  console.log("Mensaje recibido:", incomingMsg);
console.log("De:", from);
});
