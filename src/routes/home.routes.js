const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="nl">
      <head>
        <meta charset="UTF-8">
        <title>DPP Platform</title>
      </head>
      <body>
        <h1>DPP Platform 🚀</h1>
        <p>De applicatie werkt!</p>
      </body>
    </html>
  `);
});

module.exports = router;
