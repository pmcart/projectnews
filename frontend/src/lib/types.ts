// lib/types.ts
export type TweetMedia = {
  type: "image" | "video";
  url: string;
  alt?: string;
};

export type Tweet = {
  /** Frontend-friendly ID (Mongo _id) */
  id: string;
  /** Mongo's `account` */
  author: string;
  /** Mongo's `text` */
  text: string;
  /** Mongo's `datetime` */
  createdAt?: string;
  /** Mongo's `url` to the original X post */
  sourceUrl?: string;
  /** Optional media derived from `images` (if you store them) */
  media?: TweetMedia[];
  /** Mongo's `tweetId` (string on X) – used to look up tiktoks */
  tweetId?: string;
};

export type TweetDoc = {
  _id: string;
  url: string;
  account: string;
  datetime?: string;
  fetchedAt?: string;
  lastSeenAt?: string;
  images?: Array<{ url: string; alt?: string; type?: "image" | "video" }>;
  text: string;
  tiktoks_processed?: boolean;
  tweetId?: string;
  tiktoks_count?: number;
  tiktoks_processedAt?: string;
};

export type TweetTiktok = {
  _id: string;
  tweetId: string;              // ties back to tweets.tweetId
  tiktokId: string;
  tiktokUrl: string;
  tiktokDesc?: string;
  tiktokUsername?: string;
  tiktokCreateTime?: string;
};

export const mapTweetDocToTweet = (d: TweetDoc): Tweet => ({
  id: d._id,
  author: d.account,
  text: d.text,
  createdAt: d.datetime,
  sourceUrl: d.url,
  tweetId: d.tweetId,
  media: (d.images ?? []).map((m) => ({
    type: (m.type as TweetMedia["type"]) || "image",
    url: m.url,
    alt: m.alt,
  })),
});
