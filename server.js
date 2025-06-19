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

// Detectar productos rechazados
function detectarProductosRechazados(historial, productos) {
  const rechazados = new Set();
  historial.forEach(({ role, message }) => {
    if (role === 'user') {
      productos.forEach(p => {
        const nombre = p.nombre.toLowerCase();
        const msg = message.toLowerCase();
        if (msg.includes(`no quiero ${nombre}`) ||
            msg.includes(`otra que no sea ${nombre}`) ||
            msg.includes(`no ${nombre}`) ||
            msg.includes(`no quiero jumbo`) ||
            msg.includes(`no jumbo`)) {
          rechazados.add(nombre);
        }
      });
    }
  });
  return Array.from(rechazados);
}

function obtenerSugerencias(historial, productos, rechazados) {
  const ultimos = historial.map(h => h.message.toLowerCase()).join(' ');
  let sugerencias = productos.filter(p => !rechazados.includes(p.nombre.toLowerCase()));

  if (ultimos.includes("pequeño") || ultimos.includes("más chico")) {
    sugerencias = sugerencias.filter(p => p.nombre.toLowerCase().includes("grande"));
  } else if (ultimos.includes("gruesa") || ultimos.includes("resistente")) {
    sugerencias = sugerencias.filter(p => p.nombre.toLowerCase().includes("gruesa"));
  } else if (ultimos.includes("barato")) {
    sugerencias.sort((a, b) => parseFloat(a.precio) - parseFloat(b.precio));
  }

  return sugerencias.slice(0, 2);
}

async function generarPrompt(historial, estadoPedido, sugerencias) {
  const textoSugerencias = sugerencias.map((p, i) =>
    `${i + 1}. ${p.nombre.toUpperCase()} - $${p.precio}\n${p.descripcion || ''}`
  ).join('\n\n');

  let contexto = "";
  if (estadoPedido) {
    contexto = `\n\nEste cliente ya hizo un pedido: ${estadoPedido.producto} el ${estadoPedido.fecha}. Dirección: ${estadoPedido.direccion}. Tel: ${estadoPedido.telefono}`;
  }

  return `
Eres un vendedor amable y profesional de MAXIBOLSAS. Atiendes clientes por WhatsApp.

${contexto}

Estas son las opciones recomendadas ahora:

${textoSugerencias || 'No hay sugerencias compatibles con lo que el cliente busca.'}

Todos los productos incluyen envío gratis y se pagan contra entrega.

Tu tarea:
- Sugerir productos relevantes y distintos a los ya rechazados
- Si el cliente acepta, pedir dirección, número de teléfono y día de entrega (si aún no lo ha hecho)
- Ser claro, directo y amable, con mensajes cortos

Responde solo en español.`.trim();
}

function detectarDatosEntrega(texto) {
  return texto.includes("calle") || texto.includes("colonia") || texto.includes("número") || /\d{10}/.test(texto);
}

// Crear tablas
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

  console.log("Mensaje recibido:", incomingMsg);
  console.log("De:", from);

  try {
    await db.query(
      "INSERT INTO chat_history (phone, role, message) VALUES ($1, 'user', $2)",
      [from, incomingMsg]
    );

    const result = await db.query(
      "SELECT role, message FROM chat_history WHERE phone = $1 ORDER BY timestamp ASC LIMIT 10",
      [from]
    );
    const historial = result.rows;

    const productosDB = await db.query(`SELECT nombre, descripcion, precio FROM productos`);
    const productos = productosDB.rows;

    const rechazados = detectarProductosRechazados(historial, productos);
    const sugerencias = obtenerSugerencias(historial, productos, rechazados);

    const pedidoExistente = await db.query(
      "SELECT * FROM pedidos WHERE phone = $1 ORDER BY fecha DESC LIMIT 1",
      [from]
    );
    const estadoPedido = pedidoExistente.rows[0] || null;

    // Si mensaje contiene dirección y teléfono y no hay pedido registrado, guardar
    if (!estadoPedido && detectarDatosEntrega(incomingMsg)) {
      const ultimoProducto = sugerencias[0]?.nombre || 'Producto desconocido';
      await db.query(
        "INSERT INTO pedidos (phone, producto, direccion, telefono) VALUES ($1, $2, $3, $4)",
        [from, ultimoProducto, incomingMsg, incomingMsg.match(/\d{10}/)?.[0] || '']
      );
    }

    const systemPrompt = await generarPrompt(historial, estadoPedido, sugerencias);
    const messages = [
      { role: "system", content: systemPrompt },
      ...historial.map(row => ({ role: row.role, content: row.message }))
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

    const twiml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
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
