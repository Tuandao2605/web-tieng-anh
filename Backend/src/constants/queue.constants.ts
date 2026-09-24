export const QUEUE_NAME = {
  EMAIL: "email_queue",
  AUDIO: "audio_queue",
  SEARCH_INDEX: "search_index_queue",
};

export const JOB_NAME = {
  EMAIL: {
    WELCOME: "welcome_email",
    FORGOT_PASSWORD: "forgot_password",
  },
  SEARCH_INDEX: {
    SYNC_DECK: "sync_deck",
  },
};

export const JOB_DELAY = 5000;
