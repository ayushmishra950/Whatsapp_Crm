"use client";

import { API_URL } from "@/lib/api";
import { Badge } from "./ui";

export const PLATFORM_LABEL = { facebook: "Facebook", instagram: "Instagram" };

/** Stored file link (Cloudinary, or /uploads/… on the server disk) */
export const mediaUrl = (url) => (url && !/^https?:/.test(url) ? `${API_URL}${url}` : url);

const TARGET_TONE = { pending: "yellow", publishing: "blue", posted: "green", failed: "red" };
const TARGET_TEXT = { pending: "Waiting", publishing: "Posting…", posted: "Posted", failed: "Failed" };
export const TargetBadge = ({ status }) => <Badge tone={TARGET_TONE[status] || "gray"}>{TARGET_TEXT[status] || status}</Badge>;

const POST_TONE = { scheduled: "blue", publishing: "yellow", posted: "green", partial: "yellow", failed: "red", deleted: "gray" };
const POST_TEXT = { scheduled: "Scheduled", publishing: "Posting…", posted: "Posted", partial: "Partly posted", failed: "Failed", deleted: "Deleted" };
export const PostStatusBadge = ({ status }) => <Badge tone={POST_TONE[status] || "gray"}>{POST_TEXT[status] || status}</Badge>;

/** "Priya" / "@priya.learns" / "You"; Facebook hides some commenters' names until the app has Advanced Access */
export const commenterName = (c) =>
  c.fromBusiness ? (c.sentBy?.name ? `You (${c.sentBy.name})` : "You") : c.from?.name || (c.from?.username ? `@${c.from.username}` : `${c.platform === "instagram" ? "Instagram" : "Facebook"} user`);
export const nameHidden = (c) => !c.fromBusiness && !c.from?.name && !c.from?.username;
