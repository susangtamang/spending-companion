export const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const apiUrl = process.env.EXPO_PUBLIC_API_URL;
export const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true" || !clerkKey || !apiUrl;
