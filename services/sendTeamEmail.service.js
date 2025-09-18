import sendMail from "../utils/sendMail.Js";

export const sendTeamNotification = async ({
  email,
  name,
  hackathonTitle,
  teammates,
  problemStatement,
  teamName,
}) => {
  try {
    const subject = `Team Assigned for ${hackathonTitle}`;

    const data = {
      name,
      hackathonTitle,
      teammates,
      problemStatement,
      teamName,
    };

    // Send email using your existing sendMail function
    await sendMail({
      email,
      subject,
      data,
      template: "teamAssignment.ejs", // We'll create this template next
    });

    console.log(`Team notification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error("Error sending team notification:", error);
    throw new Error("Failed to send team notification email");
  }
};
