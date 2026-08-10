import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import ejs from "ejs";
import path from "node:path";
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_SECURE = process.env.SMTP_SECURE;
const SMTP_FROM = process.env.SMTP_FROM;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME;
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE === "ssl", // Use true for port 465, false for port 587
  auth: {
    user: SMTP_USERNAME,
    pass: SMTP_PASSWORD,
  },
} as SMTPTransport.Options);

export const mailService = {
  async sendMail(to: string, subject: string, message: string) {
    const info = await transporter.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM}>`,
      to,
      subject,
      html: message, // HTML version of the message
    });
    return info;
  },
  async sendWithTemplate(
    to: string,
    subject: string,
    template: string,
    options: {
      [key: string]: string;
    },
  ) {
    const viewRoot = path.join(__dirname, "..", "views");
    const templatePath = path.join(viewRoot, template + ".ejs");
    try {
      let data = await ejs.renderFile(templatePath, options);
      //Thay the va gan tracking
      const matches = data.match(
        // eslint-disable-next-line no-useless-escape
        /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/gi,
      );
      if (matches?.length) {
        matches?.forEach((item) => {
          if (item) {
            const url = `http://localhost:3000/tracking?url=${item}&mailId=1`;
            data = data.replace(item, `<a href="${url}">${item} </a>`);
          }
        });
      }
      data += `<img src="https://unicode.vn/open.php?mailId=10" width="1" height="1"/>`;
      return await this.sendMail(to, subject, data as string);
    } catch {
      return false;
    }
  },
};
