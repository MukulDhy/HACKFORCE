const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// // Rate limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100,
// });
// app.use("/api/", limiter);

// MongoDB connection
// mongoose.connect(
//   process.env.MONGODB_URI || "mongodb://localhost:27017/hackathon",
//   {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//   }
// );

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  skills: [String],
  age: Number,
  experience: { type: String, enum: ["beginner", "intermediate", "advanced"] },
  github: String,
  linkedin: String,
  phone: String,
  profilePicture: String,
  createdAt: { type: Date, default: Date.now },
});

// Hackathon Schema
const hackathonSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  registrationStartDate: { type: Date, required: true },
  registrationEndDate: { type: Date, required: true },
  maxParticipants: { type: Number, default: 100 },
  tasks: [
    {
      type: {
        type: String,
        enum: ["team", "DSA", "confidence", "debate"],
        required: true,
      },
      title: String,
      description: String,
      timeLimit: Number, // in minutes
      maxScore: { type: Number, default: 100 },
    },
  ],
  status: {
    type: String,
    enum: ["upcoming", "registration_open", "ongoing", "completed"],
    default: "upcoming",
  },
  winners: [
    {
      position: Number,
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      score: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

// Team Schema
const teamSchema = new mongoose.Schema({
  name: String,
  hackathon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hackathon",
    required: true,
  },
  members: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      role: { type: String, enum: ["leader", "member"], default: "member" },
      joinedAt: { type: Date, default: Date.now },
    },
  ],
  maxMembers: { type: Number, default: 4 },
  isRandomlyFormed: { type: Boolean, default: false },
  inviteCode: { type: String, unique: true },
  repository: {
    url: String,
    lastCommit: Date,
    commits: Number,
  },
  submissions: [
    {
      task: String,
      submittedAt: Date,
      githubUrl: String,
      score: Number,
      feedback: String,
    },
  ],
  totalScore: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Registration Schema
const registrationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  hackathon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hackathon",
    required: true,
  },
  team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  status: {
    type: String,
    enum: ["registered", "team_assigned", "participating", "completed"],
    default: "registered",
  },
  preferences: {
    preferredTeammates: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    skills: [String],
    experience: String,
  },
  registeredAt: { type: Date, default: Date.now },
});

// Chat Schema
const chatSchema = new mongoose.Schema({
  team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true },
  hackathon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hackathon",
    required: true,
  },
  messages: [
    {
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      type: { type: String, enum: ["text", "file", "image"], default: "text" },
      fileUrl: String,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  hackathon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hackathon",
    required: true,
  },
  rating: { type: Number, min: 1, max: 5, required: true },
  feedback: String,
  improvements: String,
  wouldRecommend: Boolean,
  submittedAt: { type: Date, default: Date.now },
});

// Models
const User = mongoose.model("User", userSchema);
const Hackathon = mongoose.model("Hackathon", hackathonSchema);
const Team = mongoose.model("Team", teamSchema);
const Registration = mongoose.model("Registration", registrationSchema);
const Chat = mongoose.model("Chat", chatSchema);
const Feedback = mongoose.model("Feedback", feedbackSchema);

// WebSocket connection management
const clients = new Map(); // userId -> WebSocket connection
const teamRooms = new Map(); // teamId -> Set of WebSocket connections
const hackathonRooms = new Map(); // hackathonId -> Set of WebSocket connections

// WebSocket message types
const WS_TYPES = {
  AUTHENTICATE: "authenticate",
  JOIN_TEAM_ROOM: "join_team_room",
  LEAVE_TEAM_ROOM: "leave_team_room",
  TEAM_MESSAGE: "team_message",
  TEAM_UPDATE: "team_update",
  HACKATHON_UPDATE: "hackathon_update",
  NOTIFICATION: "notification",
  ERROR: "error",
};

// WebSocket authentication middleware
const authenticateWS = async (ws, token) => {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    const user = await User.findById(decoded.userId);
    if (!user) throw new Error("User not found");

    ws.userId = user._id.toString();
    ws.user = user;
    clients.set(ws.userId, ws);

    return user;
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: WS_TYPES.ERROR,
        message: "Authentication failed",
      })
    );
    ws.close();
    return null;
  }
};

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case WS_TYPES.AUTHENTICATE:
          await authenticateWS(ws, data.token);
          ws.send(
            JSON.stringify({
              type: "authenticated",
              userId: ws.userId,
            })
          );
          break;

        case WS_TYPES.JOIN_TEAM_ROOM:
          if (!ws.userId) return;

          const teamId = data.teamId;
          if (!teamRooms.has(teamId)) {
            teamRooms.set(teamId, new Set());
          }
          teamRooms.get(teamId).add(ws);
          ws.currentTeamRoom = teamId;

          // Send recent messages
          const chat = await Chat.findOne({ team: teamId })
            .populate("messages.sender", "name email")
            .sort({ "messages.timestamp": -1 })
            .limit(50);

          if (chat) {
            ws.send(
              JSON.stringify({
                type: "chat_history",
                messages: chat.messages.slice(-50),
              })
            );
          }
          break;

        case WS_TYPES.LEAVE_TEAM_ROOM:
          if (ws.currentTeamRoom && teamRooms.has(ws.currentTeamRoom)) {
            teamRooms.get(ws.currentTeamRoom).delete(ws);
            ws.currentTeamRoom = null;
          }
          break;

        case WS_TYPES.TEAM_MESSAGE:
          if (!ws.userId || !ws.currentTeamRoom) return;

          // Save message to database
          let chat = await Chat.findOne({ team: ws.currentTeamRoom });
          if (!chat) {
            chat = new Chat({
              team: ws.currentTeamRoom,
              hackathon: data.hackathonId,
              messages: [],
            });
          }

          const newMessage = {
            sender: ws.userId,
            content: data.content,
            timestamp: new Date(),
            type: data.messageType || "text",
            fileUrl: data.fileUrl,
          };

          chat.messages.push(newMessage);
          await chat.save();

          // Populate sender info
          await chat.populate("messages.sender", "name email");
          const populatedMessage = chat.messages[chat.messages.length - 1];

          // Broadcast to team room
          const teamClients = teamRooms.get(ws.currentTeamRoom);
          if (teamClients) {
            const messageData = JSON.stringify({
              type: "new_message",
              message: populatedMessage,
            });

            teamClients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(messageData);
              }
            });
          }
          break;
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(
        JSON.stringify({
          type: WS_TYPES.ERROR,
          message: "Message processing failed",
        })
      );
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      clients.delete(ws.userId);
    }

    if (ws.currentTeamRoom && teamRooms.has(ws.currentTeamRoom)) {
      teamRooms.get(ws.currentTeamRoom).delete(ws);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Broadcast to team
const broadcastToTeam = (teamId, message) => {
  const teamClients = teamRooms.get(teamId.toString());
  if (teamClients) {
    const messageData = JSON.stringify(message);
    teamClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageData);
      }
    });
  }
};

// Broadcast to user
const broadcastToUser = (userId, message) => {
  const client = clients.get(userId.toString());
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
};

// Email configuration
const transporter = nodemailer.createTransporter({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "your-secret-key",
    async (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: "Invalid token" });
      }

      try {
        const user = await User.findById(decoded.userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        req.user = user;
        next();
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    }
  );
};

// Utility functions
const generateInviteCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const sendEmail = async (to, subject, html) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error("Email sending failed:", error);
  }
};

// Random team formation algorithm
const formRandomTeams = async (hackathonId) => {
  try {
    const registrations = await Registration.find({
      hackathon: hackathonId,
      status: "registered",
      team: { $exists: false },
    }).populate("user");

    if (registrations.length === 0) return;

    // Shuffle users
    const shuffledUsers = registrations.sort(() => 0.5 - Math.random());
    const teamSize = 4;
    const teams = [];

    for (let i = 0; i < shuffledUsers.length; i += teamSize) {
      const teamMembers = shuffledUsers.slice(i, i + teamSize);

      const team = new Team({
        name: `Team ${teams.length + 1}`,
        hackathon: hackathonId,
        members: teamMembers.map((reg, index) => ({
          user: reg.user._id,
          role: index === 0 ? "leader" : "member",
        })),
        isRandomlyFormed: true,
        inviteCode: generateInviteCode(),
      });

      await team.save();
      teams.push(team);

      // Update registrations
      for (const reg of teamMembers) {
        reg.team = team._id;
        reg.status = "team_assigned";
        await reg.save();

        // Send notification
        broadcastToUser(reg.user._id, {
          type: WS_TYPES.NOTIFICATION,
          message: `You have been assigned to ${team.name}`,
          teamId: team._id,
        });

        // Send email
        await sendEmail(
          reg.user.email,
          "Team Assignment - Hackathon",
          `<h2>Team Assignment</h2>
           <p>You have been assigned to <strong>${team.name}</strong></p>
           <p>Invite Code: <strong>${team.inviteCode}</strong></p>`
        );
      }
    }

    console.log(`Created ${teams.length} random teams`);
    return teams;
  } catch (error) {
    console.error("Random team formation failed:", error);
    throw error;
  }
};

// API Routes

// Auth Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      skills,
      experience,
      github,
      linkedin,
      phone,
    } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      name,
      skills: skills || [],
      experience,
      github,
      linkedin,
      phone,
      verificationToken: uuidv4(),
    });

    await user.save();

    // Send verification email
    await sendEmail(
      email,
      "Verify Your Account",
      `<h2>Welcome to Hackathon Portal</h2>
       <p>Please verify your account by clicking the link below:</p>
       <a href="${process.env.FRONTEND_URL}/verify/${user.verificationToken}">Verify Account</a>`
    );

    res.status(201).json({
      message:
        "User created successfully. Please check your email for verification.",
      userId: user._id,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/verify/:token", async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token });
    if (!user) {
      return res.status(400).json({ error: "Invalid verification token" });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.json({ message: "Account verified successfully" });
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// Hackathon Routes
app.get("/api/hackathons", async (req, res) => {
  try {
    const hackathons = await Hackathon.find()
      .sort({ createdAt: -1 })
      .populate("winners.team", "name members");
    res.json(hackathons);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch hackathons" });
  }
});

app.get("/api/hackathons/:id", async (req, res) => {
  try {
    const hackathon = await Hackathon.findById(req.params.id).populate(
      "winners.team",
      "name members"
    );

    if (!hackathon) {
      return res.status(404).json({ error: "Hackathon not found" });
    }

    res.json(hackathon);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch hackathon" });
  }
});

app.post(
  "/api/hackathons/:id/register",
  authenticateToken,
  async (req, res) => {
    try {
      const hackathonId = req.params.id;
      const userId = req.user._id;

      // Check if hackathon exists
      const hackathon = await Hackathon.findById(hackathonId);
      if (!hackathon) {
        return res.status(404).json({ error: "Hackathon not found" });
      }

      // Check if registration is open
      const now = new Date();
      if (
        now < hackathon.registrationStartDate ||
        now > hackathon.registrationEndDate
      ) {
        return res.status(400).json({ error: "Registration is not open" });
      }

      // Check if already registered
      const existingRegistration = await Registration.findOne({
        user: userId,
        hackathon: hackathonId,
      });

      if (existingRegistration) {
        return res
          .status(400)
          .json({ error: "Already registered for this hackathon" });
      }

      // Create registration
      const registration = new Registration({
        user: userId,
        hackathon: hackathonId,
        preferences: req.body.preferences || {},
      });

      await registration.save();

      // Send confirmation email
      await sendEmail(
        req.user.email,
        "Hackathon Registration Confirmation",
        `<h2>Registration Confirmed</h2>
       <p>You have successfully registered for ${hackathon.title}</p>
       <p>Event Date: ${hackathon.startDate.toDateString()}</p>`
      );

      res.status(201).json({
        message: "Registration successful",
        registrationId: registration._id,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  }
);

// Team Routes
app.post("/api/teams/create", authenticateToken, async (req, res) => {
  try {
    const { name, hackathonId } = req.body;

    // Check if user is registered for hackathon
    const registration = await Registration.findOne({
      user: req.user._id,
      hackathon: hackathonId,
    });

    if (!registration) {
      return res
        .status(400)
        .json({ error: "Not registered for this hackathon" });
    }

    if (registration.team) {
      return res.status(400).json({ error: "Already part of a team" });
    }

    // Create team
    const team = new Team({
      name,
      hackathon: hackathonId,
      members: [
        {
          user: req.user._id,
          role: "leader",
        },
      ],
      inviteCode: generateInviteCode(),
    });

    await team.save();

    // Update registration
    registration.team = team._id;
    registration.status = "team_assigned";
    await registration.save();

    res.status(201).json({
      message: "Team created successfully",
      team: team,
      inviteCode: team.inviteCode,
    });
  } catch (error) {
    console.error("Team creation error:", error);
    res.status(500).json({ error: "Team creation failed" });
  }
});

app.post("/api/teams/join", authenticateToken, async (req, res) => {
  try {
    const { inviteCode } = req.body;

    // Find team by invite code
    const team = await Team.findOne({ inviteCode });
    if (!team) {
      return res.status(404).json({ error: "Invalid invite code" });
    }

    // Check if team is full
    if (team.members.length >= team.maxMembers) {
      return res.status(400).json({ error: "Team is full" });
    }

    // Check if user is registered for the hackathon
    const registration = await Registration.findOne({
      user: req.user._id,
      hackathon: team.hackathon,
    });

    if (!registration) {
      return res
        .status(400)
        .json({ error: "Not registered for this hackathon" });
    }

    if (registration.team) {
      return res.status(400).json({ error: "Already part of a team" });
    }

    // Add user to team
    team.members.push({
      user: req.user._id,
      role: "member",
    });

    await team.save();

    // Update registration
    registration.team = team._id;
    registration.status = "team_assigned";
    await registration.save();

    // Notify team members
    broadcastToTeam(team._id, {
      type: WS_TYPES.TEAM_UPDATE,
      message: `${req.user.name} joined the team`,
      team: team,
    });

    res.json({
      message: "Successfully joined team",
      team: team,
    });
  } catch (error) {
    console.error("Team join error:", error);
    res.status(500).json({ error: "Failed to join team" });
  }
});

app.get("/api/teams/:id", authenticateToken, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate("members.user", "name email github linkedin")
      .populate("hackathon", "title startDate endDate");

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Check if user is part of the team
    const isMember = team.members.some(
      (member) => member.user._id.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(team);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch team" });
  }
});

// Chat Routes
app.get("/api/teams/:id/chat", authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is part of team
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    const isMember = team.members.some(
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({ error: "Access denied" });
    }

    const chat = await Chat.findOne({ team: teamId })
      .populate("messages.sender", "name email")
      .slice("messages", [-(page * limit), limit]);

    res.json(chat?.messages || []);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

// File upload
app.post(
  "/api/upload",
  authenticateToken,
  upload.single("file"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      res.json({
        message: "File uploaded successfully",
        fileUrl: `/uploads/${req.file.filename}`,
        filename: req.file.filename,
      });
    } catch (error) {
      res.status(500).json({ error: "File upload failed" });
    }
  }
);

// Serve uploaded files
app.use("/uploads", express.static("uploads"));

// Submission Routes
app.post("/api/teams/:id/submit", authenticateToken, async (req, res) => {
  try {
    const { task, githubUrl } = req.body;
    const teamId = req.params.id;

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Verify user is team leader
    const isLeader = team.members.some(
      (member) =>
        member.user.toString() === req.user._id.toString() &&
        member.role === "leader"
    );

    if (!isLeader) {
      return res.status(403).json({ error: "Only team leader can submit" });
    }

    // Add submission
    team.submissions.push({
      task,
      submittedAt: new Date(),
      githubUrl,
      score: 0, // Will be updated by evaluators
    });

    await team.save();

    // Notify team members
    broadcastToTeam(team._id, {
      type: WS_TYPES.TEAM_UPDATE,
      message: `Submission for ${task} has been submitted`,
      submission: team.submissions[team.submissions.length - 1],
    });

    res.json({ message: "Submission successful" });
  } catch (error) {
    console.error("Submission error:", error);
    res.status(500).json({ error: "Submission failed" });
  }
});

// Evaluation Routes
app.post("/api/teams/:id/evaluate", authenticateToken, async (req, res) => {
  try {
    const { submissionIndex, score, feedback } = req.body;
    const teamId = req.params.id;

    // Add admin check here if needed
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    if (!team.submissions[submissionIndex]) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Update submission
    team.submissions[submissionIndex].score = score;
    team.submissions[submissionIndex].feedback = feedback;

    // Calculate total score
    team.totalScore = team.submissions.reduce(
      (total, sub) => total + (sub.score || 0),
      0
    );

    await team.save();

    // Notify team members
    broadcastToTeam(team._id, {
      type: WS_TYPES.TEAM_UPDATE,
      message: "Your submission has been evaluated",
      evaluation: {
        score,
        feedback,
        totalScore: team.totalScore,
      },
    });

    res.json({ message: "Evaluation completed", totalScore: team.totalScore });
  } catch (error) {
    console.error("Evaluation error:", error);
    res.status(500).json({ error: "Evaluation failed" });
  }
});

// Feedback Routes
app.post(
  "/api/hackathons/:id/feedback",
  authenticateToken,
  async (req, res) => {
    try {
      const { rating, feedback, improvements, wouldRecommend } = req.body;
      const hackathonId = req.params.id;

      // Check if user participated
      const registration = await Registration.findOne({
        user: req.user._id,
        hackathon: hackathonId,
      });

      if (!registration) {
        return res
          .status(400)
          .json({ error: "You did not participate in this hackathon" });
      }

      // Check if feedback already exists
      const existingFeedback = await Feedback.findOne({
        user: req.user._id,
        hackathon: hackathonId,
      });

      if (existingFeedback) {
        return res.status(400).json({ error: "Feedback already submitted" });
      }

      // Create feedback
      const newFeedback = new Feedback({
        user: req.user._id,
        hackathon: hackathonId,
        rating,
        feedback,
        improvements,
        wouldRecommend,
      });

      await newFeedback.save();

      res.status(201).json({ message: "Feedback submitted successfully" });
    } catch (error) {
      console.error("Feedback error:", error);
      res.status(500).json({ error: "Feedback submission failed" });
    }
  }
);

// Winners and Results
app.post(
  "/api/hackathons/:id/declare-winners",
  authenticateToken,
  async (req, res) => {
    try {
      const hackathonId = req.params.id;
      const { winners } = req.body; // Array of { position, teamId, score }

      // Add admin check here
      const hackathon = await Hackathon.findById(hackathonId);
      if (!hackathon) {
        return res.status(404).json({ error: "Hackathon not found" });
      }

      // Update hackathon with winners
      hackathon.winners = winners.map((winner) => ({
        position: winner.position,
        team: winner.teamId,
        score: winner.score,
      }));
      hackathon.status = "completed";

      await hackathon.save();

      // Notify all participants
      const registrations = await Registration.find({ hackathon: hackathonId })
        .populate("user", "email name")
        .populate("team", "name");

      for (const reg of registrations) {
        const isWinner = winners.some(
          (w) => w.teamId === reg.team?._id.toString()
        );
        const winnerPosition = isWinner
          ? winners.find((w) => w.teamId === reg.team._id.toString()).position
          : null;

        // Send notification
        broadcastToUser(reg.user._id, {
          type: WS_TYPES.HACKATHON_UPDATE,
          message: isWinner
            ? `Congratulations! Your team won position ${winnerPosition}!`
            : "Hackathon results have been announced",
          hackathonId: hackathonId,
          isWinner,
          position: winnerPosition,
        });

        // Send email
        const emailSubject = isWinner
          ? `🎉 Congratulations! You won position ${winnerPosition}`
          : "Hackathon Results Announced";

        const emailContent = isWinner
          ? `<h2>🎉 Congratulations!</h2>
         <p>Your team <strong>${reg.team.name}</strong> has won position <strong>${winnerPosition}</strong> in ${hackathon.title}!</p>
         <p>We'll be reaching out soon for photos and LinkedIn shoutouts.</p>`
          : `<h2>Hackathon Results</h2>
         <p>The results for ${hackathon.title} have been announced.</p>
         <p>Thank you for your participation!</p>`;

        await sendEmail(reg.user.email, emailSubject, emailContent);
      }

      res.json({ message: "Winners declared successfully" });
    } catch (error) {
      console.error("Winner declaration error:", error);
      res.status(500).json({ error: "Failed to declare winners" });
    }
  }
);

// LinkedIn and Social Media Integration
app.post(
  "/api/teams/:id/submit-photos",
  authenticateToken,
  upload.array("photos", 5),
  async (req, res) => {
    try {
      const teamId = req.params.id;
      const { description } = req.body;

      const team = await Team.findById(teamId)
        .populate("members.user", "name email linkedin")
        .populate("hackathon", "title");

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Verify user is part of team
      const isMember = team.members.some(
        (member) => member.user._id.toString() === req.user._id.toString()
      );

      if (!isMember) {
        return res.status(403).json({ error: "Access denied" });
      }

      const photoUrls = req.files.map((file) => `/uploads/${file.filename}`);

      // Store photo submission (you might want a separate schema for this)
      // For now, we'll add it to team data
      if (!team.photoSubmissions) {
        team.photoSubmissions = [];
      }

      team.photoSubmissions.push({
        photos: photoUrls,
        description,
        submittedBy: req.user._id,
        submittedAt: new Date(),
      });

      await team.save();

      // Prepare LinkedIn post content
      const linkedinContent = {
        teamName: team.name,
        hackathonTitle: team.hackathon.title,
        members: team.members.map((m) => ({
          name: m.user.name,
          linkedin: m.user.linkedin,
        })),
        photos: photoUrls,
        description,
      };

      // Store for manual LinkedIn posting (or integrate with LinkedIn API)
      // You would implement LinkedIn API integration here

      res.json({
        message: "Photos submitted successfully",
        photoUrls,
        linkedinContent,
      });
    } catch (error) {
      console.error("Photo submission error:", error);
      res.status(500).json({ error: "Photo submission failed" });
    }
  }
);

// User Profile Routes
app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");

    // Get user's registrations and teams
    const registrations = await Registration.find({ user: req.user._id })
      .populate("hackathon", "title startDate endDate status")
      .populate("team", "name members totalScore");

    res.json({
      user,
      registrations,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const { name, skills, experience, github, linkedin, phone } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update fields
    if (name) user.name = name;
    if (skills) user.skills = skills;
    if (experience) user.experience = experience;
    if (github) user.github = github;
    if (linkedin) user.linkedin = linkedin;
    if (phone) user.phone = phone;

    user.updatedAt = new Date();
    await user.save();

    res.json({ message: "Profile updated successfully", user: user });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Profile update failed" });
  }
});

// Admin Routes (you should add proper admin authentication)
app.post("/api/admin/hackathons", authenticateToken, async (req, res) => {
  try {
    // Add admin check here
    const hackathon = new Hackathon(req.body);
    await hackathon.save();

    res.status(201).json({
      message: "Hackathon created successfully",
      hackathon,
    });
  } catch (error) {
    console.error("Hackathon creation error:", error);
    res.status(500).json({ error: "Hackathon creation failed" });
  }
});

app.post(
  "/api/admin/hackathons/:id/form-random-teams",
  authenticateToken,
  async (req, res) => {
    try {
      // Add admin check here
      const hackathonId = req.params.id;
      const teams = await formRandomTeams(hackathonId);

      res.json({
        message: `Successfully formed ${teams.length} random teams`,
        teams: teams.length,
      });
    } catch (error) {
      console.error("Random team formation error:", error);
      res.status(500).json({ error: "Random team formation failed" });
    }
  }
);

app.get(
  "/api/admin/hackathons/:id/stats",
  authenticateToken,
  async (req, res) => {
    try {
      // Add admin check here
      const hackathonId = req.params.id;

      const totalRegistrations = await Registration.countDocuments({
        hackathon: hackathonId,
      });
      const totalTeams = await Team.countDocuments({ hackathon: hackathonId });
      const averageTeamSize =
        totalTeams > 0 ? totalRegistrations / totalTeams : 0;

      const teamsWithSubmissions = await Team.countDocuments({
        hackathon: hackathonId,
        "submissions.0": { $exists: true },
      });

      const feedbackCount = await Feedback.countDocuments({
        hackathon: hackathonId,
      });
      const averageRating = await Feedback.aggregate([
        { $match: { hackathon: mongoose.Types.ObjectId(hackathonId) } },
        { $group: { _id: null, avgRating: { $avg: "$rating" } } },
      ]);

      res.json({
        totalRegistrations,
        totalTeams,
        averageTeamSize: Math.round(averageTeamSize * 100) / 100,
        teamsWithSubmissions,
        submissionRate:
          totalTeams > 0 ? (teamsWithSubmissions / totalTeams) * 100 : 0,
        feedbackCount,
        averageRating: averageRating[0]?.avgRating || 0,
      });
    } catch (error) {
      console.error("Stats fetch error:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  }
);

// Scheduled Tasks with node-cron

// Send registration reminders
cron.schedule("0 9 * * *", async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Find hackathons with registration ending tomorrow
    const hackathons = await Hackathon.find({
      registrationEndDate: {
        $gte: tomorrow,
        $lt: dayAfterTomorrow,
      },
    });

    for (const hackathon of hackathons) {
      // Get all registered users for this hackathon
      const registrations = await Registration.find({
        hackathon: hackathon._id,
      }).populate("user", "email name");

      // Send reminder emails
      for (const registration of registrations) {
        await sendEmail(
          registration.user.email,
          `Reminder: ${hackathon.title} Registration Ends Tomorrow`,
          `<h2>Registration Reminder</h2>
           <p>Hi ${registration.user.name},</p>
           <p>This is a friendly reminder that registration for <strong>${
             hackathon.title
           }</strong> ends tomorrow!</p>
           <p>Event starts: ${hackathon.startDate.toDateString()}</p>
           <p>Make sure you're ready to participate!</p>`
        );
      }
    }

    console.log(`Sent reminders for ${hackathons.length} hackathons`);
  } catch (error) {
    console.error("Reminder email error:", error);
  }
});

// Auto form random teams 1 day before hackathon starts
cron.schedule("0 0 * * *", async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Find hackathons starting tomorrow
    const hackathons = await Hackathon.find({
      startDate: {
        $gte: tomorrow,
        $lt: dayAfterTomorrow,
      },
    });

    for (const hackathon of hackathons) {
      await formRandomTeams(hackathon._id);
      console.log(`Formed random teams for hackathon: ${hackathon.title}`);
    }
  } catch (error) {
    console.error("Auto team formation error:", error);
  }
});

// Send post-hackathon feedback requests
cron.schedule("0 12 * * *", async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find hackathons that ended yesterday
    const hackathons = await Hackathon.find({
      endDate: {
        $gte: yesterday,
        $lt: today,
      },
    });

    for (const hackathon of hackathons) {
      const registrations = await Registration.find({
        hackathon: hackathon._id,
      }).populate("user", "email name");

      // Send feedback request emails
      for (const registration of registrations) {
        await sendEmail(
          registration.user.email,
          `Feedback Request: ${hackathon.title}`,
          `<h2>We'd Love Your Feedback!</h2>
           <p>Hi ${registration.user.name},</p>
           <p>Thank you for participating in <strong>${hackathon.title}</strong>!</p>
           <p>Please take a few minutes to share your feedback and help us improve future events.</p>
           <a href="${process.env.FRONTEND_URL}/hackathons/${hackathon._id}/feedback" 
              style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
              Share Feedback
           </a>`
        );
      }
    }

    console.log(`Sent feedback requests for ${hackathons.length} hackathons`);
  } catch (error) {
    console.error("Feedback request error:", error);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

module.exports = { app, server, wss };
