import { mailService } from "../services/mail.service";
import path from "node:path";

export interface MailData {
  info: {
    to: string;
    subject: string;
  };
  options: {
    name: string;
    orderId: string;
  };
}
export abstract class Mail<T extends MailData> {
  private templatePath = "";
  private mailData;
  constructor(data: T) {
    const templatePath = path.join("mail", this.view());
    this.templatePath = templatePath;
    this.mailData = data;
  }
  send() {
    return mailService.sendWithTemplate(
      this.mailData.info.to,
      this.mailData.info.subject,
      this.templatePath,
      this.mailData.options,
    );
  }
  abstract view(): string;
}
