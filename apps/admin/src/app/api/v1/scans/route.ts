import { manualMutation } from "@/server/scan-handlers";
export async function POST(request: Request) { return manualMutation(request); }
