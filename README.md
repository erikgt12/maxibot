
# MAXIBOLSAS WhatsApp Bot (Render Deployment)

This Node.js bot connects Twilio WhatsApp Sandbox to OpenAI (GPT) and responds in natural Spanish to help you sell trash bags and close deals.

## 🛠 Deployment on Render

1. Go to https://render.com
2. Create a new Web Service
3. Connect your GitHub repo or paste this code
4. Add Environment Variables:
   - `OPENAI_API_KEY`: your OpenAI API key
5. Set Build Command: `npm install`
6. Set Start Command: `npm start`
7. Set the route `/whatsapp-bot` as the Twilio webhook

## 🧪 Test in Twilio

1. Go to Twilio Console > WhatsApp Sandbox
2. Link your phone via join code
3. In "WHEN A MESSAGE COMES IN", paste your Render URL + `/whatsapp-bot`

Example: `https://your-render-app.onrender.com/whatsapp-bot`

Enjoy smart Spanish sales responses that close deals!
