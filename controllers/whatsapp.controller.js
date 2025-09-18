import whatsappService from "../services/whatsapp.service.js";

const sendMessage = async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await whatsappService.sendWhatsAppMessage(to, message);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};

const receiveMessage = (req, res) => {
  // This is for handling incoming messages (webhook)
  const incomingMsg = req.body.Body;
  const sender = req.body.From;

  console.log(`Received message from ${sender}: ${incomingMsg}`);

  // Here you can add logic to process incoming messages
  // and potentially send automated replies

  res.status(200).send();
};

export { sendMessage, receiveMessage };
