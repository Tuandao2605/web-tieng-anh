import { Mail, MailData } from "./base.mail";

export class CreateOrder<T extends MailData> extends Mail<T> {
  constructor(data: T) {
    super(data);
  }

  view() {
    return "order";
  }
}
