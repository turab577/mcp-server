import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVER_NAME = "upwork-mcp-server";
const SERVER_VERSION = "1.0.0";
const UPWORK_API_BASE = "https://api.upwork.com/graphql";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpworkConfig {
  accessToken: string;
}

interface JobSearchParams {
  query: string;
  category?: string;
  minBudget?: number;
  maxBudget?: number;
  jobType?: "fixed" | "hourly";
  experienceLevel?: "entry" | "intermediate" | "expert";
  limit?: number;
}

interface ProposalParams {
  jobId: string;
  coverLetter: string;
  bidAmount: number;
  deliveryDays?: number;
}

// ─── Upwork API Client ────────────────────────────────────────────────────────

class UpworkClient {
  private readonly accessToken: string;

  constructor(config: UpworkConfig) {
    this.accessToken = config.accessToken;
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(UPWORK_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Upwork API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data: T; errors?: { message: string }[] };

    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    return json.data;
  }

  async searchJobs(params: JobSearchParams) {
    const query = `
      query SearchJobs(
        $query: String!
        $category: String
        $minBudget: Float
        $maxBudget: Float
        $jobType: String
        $experienceLevel: String
        $limit: Int
      ) {
        jobPostings(
          searchExpression: $query
          category: $category
          budgetMin: $minBudget
          budgetMax: $maxBudget
          jobType: $jobType
          experienceLevel: $experienceLevel
          first: $limit
        ) {
          edges {
            node {
              id
              title
              description
              budget { type amount }
              skills { name }
              postedAt
              client {
                totalSpent
                totalHires
                country
              }
            }
          }
          totalCount
        }
      }
    `;

    return this.graphql(query, { ...params, limit: params.limit ?? 10 });
  }

  async getJobDetails(jobId: string) {
    const query = `
      query GetJob($id: ID!) {
        jobPosting(id: $id) {
          id
          title
          description
          budget { type amount }
          skills { name }
          postedAt
          proposals { totalCount }
          client {
            totalSpent
            totalHires
            rating
            country
            memberSince
          }
        }
      }
    `;

    return this.graphql(query, { id: jobId });
  }

  async submitProposal(params: ProposalParams) {
    const mutation = `
      mutation SubmitProposal(
        $jobId: ID!
        $coverLetter: String!
        $bidAmount: Float!
        $deliveryDays: Int
      ) {
        submitProposal(input: {
          jobId: $jobId
          coverLetter: $coverLetter
          bidAmount: $bidAmount
          deliveryDays: $deliveryDays
        }) {
          id
          status
          submittedAt
        }
      }
    `;

    return this.graphql(mutation, params as any);
  }

  async getActiveContracts() {
    const query = `
      query GetContracts {
        contracts(status: ACTIVE) {
          edges {
            node {
              id
              title
              startedAt
              client { name country }
              hourlyRate
              weeklyLimit
            }
          }
        }
      }
    `;

    return this.graphql(query);
  }

  async getFreelancerProfile() {
    const query = `
      query GetProfile {
        freelancerProfile {
          id
          name
          title
          overview
          hourlyRate
          skills { name }
          jobSuccess
          totalEarned
          availability
        }
      }
    `;

    return this.graphql(query);
  }

  async getEarnings(fromDate?: string, toDate?: string) {
    const query = `
      query GetEarnings($from: String, $to: String) {
        earnings(fromDate: $from, toDate: $to) {
          totalAmount
          currency
          breakdown {
            contractId
            contractTitle
            amount
            period
          }
        }
      }
    `;

    return this.graphql(query, { from: fromDate, to: toDate });
  }
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

const upwork = new UpworkClient({
  accessToken:  "somethingfornow",
});

// ─── Tool: Search Jobs ────────────────────────────────────────────────────────

server.tool(
  "search_jobs",
  "Search for job postings on Upwork matching given criteria",
  {
    query: z.string().describe("Keywords to search for in job postings"),
    category: z.string().optional().describe("Job category (e.g. 'Web Development')"),
    minBudget: z.number().optional().describe("Minimum budget in USD"),
    maxBudget: z.number().optional().describe("Maximum budget in USD"),
    jobType: z.enum(["fixed", "hourly"]).optional().describe("Contract type"),
    experienceLevel: z
      .enum(["entry", "intermediate", "expert"])
      .optional()
      .describe("Required experience level"),
    limit: z.number().min(1).max(50).optional().describe("Number of results to return (max 50)"),
  },
  async (params) => {
    try {
      const results = await upwork.searchJobs(params);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching jobs: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Job Details ────────────────────────────────────────────────────

server.tool(
  "get_job_details",
  "Retrieve full details for a specific Upwork job posting",
  {
    jobId: z.string().describe("The unique ID of the Upwork job posting"),
  },
  async ({ jobId }) => {
    try {
      const details = await upwork.getJobDetails(jobId);
      return {
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching job details: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Submit Proposal ────────────────────────────────────────────────────

server.tool(
  "submit_proposal",
  "Submit a proposal for an Upwork job posting",
  {
    jobId: z.string().describe("The ID of the job to apply for"),
    coverLetter: z.string().min(100).describe("Your cover letter (minimum 100 characters)"),
    bidAmount: z.number().positive().describe("Your bid amount in USD"),
    deliveryDays: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Estimated delivery time in days (for fixed-price jobs)"),
  },
  async (params) => {
    try {
      const result = await upwork.submitProposal(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error submitting proposal: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Active Contracts ───────────────────────────────────────────────

server.tool(
  "get_active_contracts",
  "List all currently active contracts on your Upwork account",
  {},
  async () => {
    try {
      const contracts = await upwork.getActiveContracts();
      return {
        content: [{ type: "text", text: JSON.stringify(contracts, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error fetching contracts: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Freelancer Profile ─────────────────────────────────────────────

server.tool(
  "get_profile",
  "Retrieve your Upwork freelancer profile information",
  {},
  async () => {
    try {
      const profile = await upwork.getFreelancerProfile();
      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching profile: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Earnings ───────────────────────────────────────────────────────

server.tool(
  "get_earnings",
  "Retrieve your Upwork earnings summary, optionally filtered by date range",
  {
    fromDate: z
      .string()
      .optional()
      .describe("Start date for earnings report (ISO 8601, e.g. '2024-01-01')"),
    toDate: z
      .string()
      .optional()
      .describe("End date for earnings report (ISO 8601, e.g. '2024-12-31')"),
  },
  async ({ fromDate, toDate }) => {
    try {
      const earnings = await upwork.getEarnings(fromDate, toDate);
      return {
        content: [{ type: "text", text: JSON.stringify(earnings, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching earnings: ${(err as Error).message}` }],
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