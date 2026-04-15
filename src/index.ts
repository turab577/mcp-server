import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVER_NAME = "linkedin-mcp-server";
const SERVER_VERSION = "1.0.0";
const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

// Replace these with your LinkedIn Developer App credentials
// Get them at: https://www.linkedin.com/developers/apps
const ACCESS_TOKEN = process.env.Linkedin_ACCESS_TOKEN || "empty";

// ─── LinkedIn API Client ──────────────────────────────────────────────────────

class LinkedInClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async get<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${LINKEDIN_API_BASE}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!response.ok) throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private async post<T>(endpoint: string, body: object): Promise<T> {
    const response = await fetch(`${LINKEDIN_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${LINKEDIN_API_BASE}${endpoint}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!response.ok) throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  async getMyProfile() {
    return this.get("/me?projection=(id,firstName,lastName,headline,profilePicture,vanityName)");
  }

  async getMyEmailAddress() {
    return this.get("/emailAddress?q=members&projection=(elements*(handle~))");
  }

  async getConnections(start = "0", count = "10") {
    return this.get("/connections?q=viewer&projection=(elements*(to~(id,firstName,lastName,headline)))", {
      start,
      count,
    });
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  async createPost(authorUrn: string, text: string, visibility: string = "PUBLIC") {
    return this.post("/ugcPosts", {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": visibility,
      },
    });
  }

  async deletePost(postUrn: string) {
    const encoded = encodeURIComponent(postUrn);
    return this.delete(`/ugcPosts/${encoded}`);
  }

  async getMyPosts(authorUrn: string, count = "10") {
    const encoded = encodeURIComponent(authorUrn);
    return this.get(`/ugcPosts?q=authors&authors=List(${encoded})&count=${count}`);
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async getConversations() {
    return this.get("/conversations?keyVersion=LEGACY_INBOX");
  }

  async getMessages(conversationId: string) {
    return this.get(`/conversations/${conversationId}/events`);
  }

  async sendMessage(recipientUrn: string, messageText: string) {
    return this.post("/messages", {
      body: messageText,
      recipients: [recipientUrn],
      subject: "",
      messageType: "MEMBER_TO_MEMBER",
    });
  }
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

const linkedin = new LinkedInClient(ACCESS_TOKEN);

// ─── Tool: Get My Profile ─────────────────────────────────────────────────────

server.tool(
  "get_my_profile",
  "Get your LinkedIn profile information including name, headline, and profile picture",
  {},
  async () => {
    try {
      const [profile, email] = await Promise.all([
        linkedin.getMyProfile(),
        linkedin.getMyEmailAddress(),
      ]);
      return {
        content: [{ type: "text", text: JSON.stringify({ profile, email }, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching profile: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Connections ────────────────────────────────────────────────────

server.tool(
  "get_connections",
  "Get a list of your LinkedIn connections",
  {
    start: z.string().optional().describe("Pagination start index (default: '0')"),
    count: z.string().optional().describe("Number of connections to fetch (default: '10', max: '500')"),
  },
  async ({ start, count }) => {
    try {
      const result = await linkedin.getConnections(start ?? "0", count ?? "10");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching connections: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Create Post ────────────────────────────────────────────────────────

server.tool(
  "create_post",
  "Create a new LinkedIn post on your profile",
  {
    authorUrn: z.string().describe("Your LinkedIn member URN, e.g. 'urn:li:person:ABC123'"),
    text: z.string().describe("The text content of the post"),
    visibility: z
      .enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN"])
      .optional()
      .describe("Who can see the post (default: PUBLIC)"),
  },
  async ({ authorUrn, text, visibility }) => {
    try {
      const result = await linkedin.createPost(authorUrn, text, visibility ?? "PUBLIC");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error creating post: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get My Posts ───────────────────────────────────────────────────────

server.tool(
  "get_my_posts",
  "Fetch your recent LinkedIn posts",
  {
    authorUrn: z.string().describe("Your LinkedIn member URN, e.g. 'urn:li:person:ABC123'"),
    count: z.string().optional().describe("Number of posts to fetch (default: '10')"),
  },
  async ({ authorUrn, count }) => {
    try {
      const result = await linkedin.getMyPosts(authorUrn, count ?? "10");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching posts: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Delete Post ────────────────────────────────────────────────────────

server.tool(
  "delete_post",
  "Delete one of your LinkedIn posts by its URN",
  {
    postUrn: z.string().describe("The URN of the post to delete, e.g. 'urn:li:ugcPost:ABC123'"),
  },
  async ({ postUrn }) => {
    try {
      const result = await linkedin.deletePost(postUrn);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error deleting post: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Conversations ──────────────────────────────────────────────────

server.tool(
  "get_conversations",
  "Get your LinkedIn message conversations/inbox",
  {},
  async () => {
    try {
      const result = await linkedin.getConversations();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching conversations: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Messages ───────────────────────────────────────────────────────

server.tool(
  "get_messages",
  "Get messages from a specific LinkedIn conversation",
  {
    conversationId: z.string().describe("The ID of the conversation to fetch messages from"),
  },
  async ({ conversationId }) => {
    try {
      const result = await linkedin.getMessages(conversationId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching messages: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Send Message ───────────────────────────────────────────────────────

server.tool(
  "send_message",
  "Send a direct message to a LinkedIn connection",
  {
    recipientUrn: z.string().describe("The URN of the recipient, e.g. 'urn:li:person:ABC123'"),
    messageText: z.string().describe("The text content of the message to send"),
  },
  async ({ recipientUrn, messageText }) => {
    try {
      const result = await linkedin.sendMessage(recipientUrn, messageText);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error sending message: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Start Server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});