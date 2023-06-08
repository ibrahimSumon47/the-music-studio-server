const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const port = process.env.PORT || 5000;


// middleware
app.use(cors());
app.use(express.json());


app.get("/", (req, res) => {
    res.send("Studio is running");
  });
  
  app.listen(port, () => {
    console.log(`Studio is running on port ${port}`);
  });