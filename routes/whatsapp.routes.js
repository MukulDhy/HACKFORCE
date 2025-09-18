import express from "express";
import {
  sendMessage,
  receiveMessage,
} from "../controllers/whatsapp.controller.js";

const router = express.Router();

// Send message
router.post("/send", sendMessage);

// Receive message webhook (for replies)
router.post("/webhook", receiveMessage);

export default router;
