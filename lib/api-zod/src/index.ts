export * from "./generated/api";
// Explicitly select the transport query type when Orval also emits its Zod
// inference alias; keep both schema values and the existing model exports.
export type { UploadOperationalPhotoParams } from "./generated/types/uploadOperationalPhotoParams";
export type { ResolveNotificationDestinationParams } from "./generated/types/resolveNotificationDestinationParams";
export * from "./generated/types";
