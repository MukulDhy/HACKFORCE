import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config({ path: "../config/config.env" });
import path from "path";
import ejs from "ejs";

const sendMail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      service: process.env.SMTP_SERVICE,
      auth: {
        user: process.env.SMTP_MAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const { email, subject, data, template } = options;

    // Get the path to the email template file
    const templatePath = path.join(__dirname, "../templates", template);

    // Render the email template with EJS
    const html = await ejs.renderFile(templatePath, data);

    /* Mail Option */
    const mailOptions = {
      from: process.env.SMTP_MAIL,
      to: email,
      subject,
      html,
    };

    const res = await transporter.sendMail(mailOptions);
    console.log("Email Responses : ", res);
  } catch (error) {
    throw new Error("Can't send mail || Error: " + error);
  }
};

export default sendMail;
