const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const bodyParser = require("body-parser");
const config = require("./config/config.js");
const http = require("http");
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const compression = require("compression");
// const { defaultLimiter } = require("./middlewares/rateLimit");
const errorHandler = require("./middlewares/error");
const authRouter = require("./routes/auth.routes.js");
// Route imports
// const authRoute = require("");

const app = express();

const server = http.createServer(app);

connectDB();

// Body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(bodyParser.json());

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Logging
app.use(morgan("combined", { stream: logger.stream }));

// Set static folder
app.use(express.static(path.join(__dirname, "public")));

// Root route
app.get("/", (req, res) => {
  res.send("API is running");
});

app.use("/api/user", authRouter);

// app.use("/api/team");

app.get("*", (req, res) => {
  res.send("Website route not found");
});

app.use(errorHandler);

// Start server
const PORT = config.PORT;
server.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server running in ${config.NODE_ENV} mode on port ${PORT}`);
});

// Initialize WebSocket service (if you still need this)
const webSocketService = require("./services/websocket.service");
webSocketService.initialize(server);

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

// Export server, app, io, and mqttService
module.exports = { app, server };
