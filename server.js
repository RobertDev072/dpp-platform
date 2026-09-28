const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
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

app.listen(PORT, () => {
  console.log(`DPP Platform draait op poort ${PORT}`);
});