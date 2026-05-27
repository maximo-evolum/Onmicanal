import { Router } from "express";
import { getDefaultTenant } from "../services/conversation.service.js";
import { testBotMessage } from "../services/bot-debug.service.js";

export const devBotRouter = Router();

devBotRouter.post("/dev/test-bot", async (req, res) => {
  try {
    const { message, channel = "whatsapp" } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        error: "message es requerido"
      });
    }

    const tenant = await getDefaultTenant();

    const result = await testBotMessage({
      tenant,
      channel,
      message
    });

    return res.json(result);
  } catch (error) {
    console.error("Dev test bot error:", error);
    return res.status(500).json({
      error: "No se pudo probar el bot"
    });
  }
});