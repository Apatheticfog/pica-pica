import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { libraryClient } from "@/data/library-client";
import type { ArtworkKind, BootstrapState, LibrarySnapshot, MetadataUpdate, ScanResult } from "@/types/library";

interface LibraryContextValue {
  bootstrap: BootstrapState | null;
  library: LibrarySnapshot | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  configure: (rootPath: string) => Promise<ScanResult>;
  rescan: () => Promise<ScanResult>;
  updateMetadata: (update: MetadataUpdate) => Promise<void>;
  applyMetadata: (gameId: string, rawgId: string) => Promise<void>;
  setCustomArtwork: (gameId: string, kind: ArtworkKind, sourcePath: string) => Promise<void>;
  clearError: () => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const libraryRevisionRef = useRef(0);
  const activeScanCountRef = useRef(0);

  const beginScanning = useCallback(() => {
    activeScanCountRef.current += 1;
    setScanning(true);
  }, []);

  const finishScanning = useCallback(() => {
    activeScanCountRef.current = Math.max(0, activeScanCountRef.current - 1);
    if (activeScanCountRef.current === 0) setScanning(false);
  }, []);

  useEffect(() => {
    let active = true;
    libraryClient
      .bootstrap()
      .then((result) => {
        if (!active) return;
        const bootstrapRevision = ++libraryRevisionRef.current;
        setBootstrap(result);
        setLibrary(result.library);
        if (result.configured && result.ffmpegAvailable && result.mediaCompatibilityScanRequired) {
          beginScanning();
          void libraryClient
            .scan()
            .then(async (scanResult) => {
              if (!active) return;
              let nextLibrary = scanResult.library;
              if (libraryRevisionRef.current !== bootstrapRevision) {
                const reconciliationRevision = libraryRevisionRef.current;
                nextLibrary = await libraryClient.snapshot();
                if (!active || libraryRevisionRef.current !== reconciliationRevision) return;
              }
              libraryRevisionRef.current += 1;
              setLibrary(nextLibrary);
              setBootstrap((current) => ({
                ...(current ?? result),
                rootPath: nextLibrary.rootPath,
                cachePath: nextLibrary.cachePath,
                ffmpegAvailable: nextLibrary.ffmpegAvailable,
                ffmpegSource: nextLibrary.ffmpegSource,
                mediaCompatibilityScanRequired: false,
                library: nextLibrary,
              }));
            })
            .catch((cause) => {
              if (active) setError(messageFrom(cause));
            })
            .finally(() => {
              if (active) finishScanning();
            });
        }
      })
      .catch((cause) => active && setError(messageFrom(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [beginScanning, finishScanning]);

  const configure = useCallback(async (rootPath: string) => {
    beginScanning();
    setError(null);
    try {
      const result = await libraryClient.configure(rootPath);
      libraryRevisionRef.current += 1;
      setLibrary(result.library);
      setBootstrap({
        configured: true,
        rootPath: result.library.rootPath,
        cachePath: result.library.cachePath,
        ffmpegAvailable: result.library.ffmpegAvailable,
        ffmpegSource: result.library.ffmpegSource,
        mediaCompatibilityScanRequired: false,
        library: result.library,
      });
      return result;
    } catch (cause) {
      setError(messageFrom(cause));
      throw cause;
    } finally {
      finishScanning();
    }
  }, [beginScanning, finishScanning]);

  const rescan = useCallback(async () => {
    beginScanning();
    setError(null);
    const scanRevision = libraryRevisionRef.current;
    try {
      const result = await libraryClient.scan();
      let nextLibrary = result.library;
      if (libraryRevisionRef.current !== scanRevision) {
        const reconciliationRevision = libraryRevisionRef.current;
        nextLibrary = await libraryClient.snapshot();
        if (libraryRevisionRef.current !== reconciliationRevision) return result;
      }
      libraryRevisionRef.current += 1;
      setLibrary(nextLibrary);
      return { ...result, library: nextLibrary };
    } catch (cause) {
      setError(messageFrom(cause));
      throw cause;
    } finally {
      finishScanning();
    }
  }, [beginScanning, finishScanning]);

  const updateMetadata = useCallback(async (update: MetadataUpdate) => {
    const nextLibrary = await libraryClient.updateMetadata(update);
    libraryRevisionRef.current += 1;
    setLibrary(nextLibrary);
  }, []);

  const applyMetadata = useCallback(async (gameId: string, rawgId: string) => {
    const nextLibrary = await libraryClient.applyMetadata(gameId, rawgId);
    libraryRevisionRef.current += 1;
    setLibrary(nextLibrary);
  }, []);

  const setCustomArtwork = useCallback(async (gameId: string, kind: ArtworkKind, sourcePath: string) => {
    const nextLibrary = await libraryClient.setCustomArtwork(gameId, kind, sourcePath);
    libraryRevisionRef.current += 1;
    setLibrary(nextLibrary);
  }, []);

  const value = useMemo(
    () => ({
      bootstrap,
      library,
      loading,
      scanning,
      error,
      configure,
      rescan,
      updateMetadata,
      applyMetadata,
      setCustomArtwork,
      clearError: () => setError(null),
    }),
    [bootstrap, library, loading, scanning, error, configure, rescan, updateMetadata, applyMetadata, setCustomArtwork],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

// The hook intentionally lives beside its provider so the context stays private.
// eslint-disable-next-line react-refresh/only-export-components
export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useLibrary must be used inside LibraryProvider");
  return context;
}
