const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json());

// Allow the Black Market Advisor webpage to contact this server.
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.post("/send-alert", async (req, res) => {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    const { message } = req.body;

    if (!webhookUrl) {
        return res.status(500).json({
            error: "DISCORD_WEBHOOK_URL has not been configured."
        });
    }

    if (!message || typeof message !== "string") {
        return res.status(400).json({
            error: "A message is required."
        });
    }

    try {
        const discordResponse = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                content: message
            })
        });

        if (!discordResponse.ok) {
            throw new Error(
                `Discord returned status ${discordResponse.status}`
            );
        }

        res.json({
            success: true
        });
    } catch (error) {
        console.error("Discord alert failed:", error);

        res.status(500).json({
            error: "The Discord alert could not be sent."
        });
    }
});

app.listen(PORT, () => {
    console.log(`Discord alert server running at http://localhost:${PORT}`);
});