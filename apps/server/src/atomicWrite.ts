import { Effect, FileSystem, Path, Predicate } from "effect";
import * as PlatformError from "effect/PlatformError";
import * as Random from "effect/Random";

const isPlatformError = (u: unknown): u is PlatformError.PlatformError =>
  Predicate.isTagged(u, "PlatformError");

const shouldFallbackToDirectWrite = (error: unknown) =>
  isPlatformError(error) &&
  (error.reason._tag === "PermissionDenied" ||
    error.reason._tag === "BadResource" ||
    error.reason._tag === "Busy" ||
    error.reason._tag === "Unknown");

export const writeFileStringAtomically = (input: {
  readonly filePath: string;
  readonly contents: string;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempFileId = yield* Random.nextUUIDv4;
      const targetDirectory = path.dirname(input.filePath);

      yield* fs.makeDirectory(targetDirectory, { recursive: true });
      const tempDirectory = yield* fs.makeTempDirectoryScoped({
        directory: targetDirectory,
        prefix: `${path.basename(input.filePath)}.`,
      });
      const tempPath = path.join(tempDirectory, `${tempFileId}.tmp`);

      yield* fs.writeFileString(tempPath, input.contents);
      yield* fs.rename(tempPath, input.filePath).pipe(
        Effect.catch((error) =>
          shouldFallbackToDirectWrite(error)
            ? Effect.logDebug("atomic file rename failed, writing in place instead", {
                path: input.filePath,
                reason: error.reason._tag,
              }).pipe(Effect.flatMap(() => fs.writeFileString(input.filePath, input.contents)))
            : Effect.fail(error),
        ),
      );
    }),
  );
