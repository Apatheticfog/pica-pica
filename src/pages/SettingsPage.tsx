import { CheckCircle2, Database, ExternalLink, FolderOpen, HardDrive, KeyRound, ShieldCheck, Video } from "lucide-react";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { PageContainer, PageHeading } from "@/components/layout/PageContainer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { useLibrary } from "@/features/library/LibraryProvider";
import type { ProviderSettings } from "@/types/library";

type Provider = "rawg" | "steamgriddb";

export function SettingsPage() {
  const { library } = useLibrary();
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null);
  const [rawgKey, setRawgKey] = useState("");
  const [steamGridKey, setSteamGridKey] = useState("");
  const [saving, setSaving] = useState<Provider | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void libraryClient.providerSettings().then(setProviderSettings).catch((cause) => setError(String(cause)));
  }, []);

  async function saveKey(event: FormEvent, provider: Provider) {
    event.preventDefault();
    const value = provider === "rawg" ? rawgKey : steamGridKey;
    if (!value.trim()) return;
    setSaving(provider);
    setError(null);
    setNotice(null);
    try {
      setProviderSettings(await libraryClient.saveProviderKey(provider, value));
      if (provider === "rawg") setRawgKey("");
      else setSteamGridKey("");
      setNotice(`${provider === "rawg" ? "RAWG" : "SteamGridDB"} key was saved in your operating system's secure credential store.`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(null);
    }
  }

  async function openProviderPage(url: string) {
    setError(null);
    try {
      await libraryClient.openExternal(url);
    } catch (cause) {
      setError(`Could not open the provider page. ${String(cause)}`);
    }
  }

  const ffmpegLabel = !library?.ffmpegAvailable
    ? "Not found — thumbnails will be skipped"
    : library.ffmpegSource === "bundled"
      ? "Bundled with Pica Pica"
      : "System installation detected";
  const rows = [
    { icon: FolderOpen, label: "Library folder", value: library?.rootPath ?? "Not configured" },
    { icon: Database, label: "Local cache", value: library?.cachePath ?? "—" },
    { icon: Video, label: "FFmpeg", value: ffmpegLabel },
    { icon: HardDrive, label: "Storage mode", value: "Local app data; original clips remain untouched" },
  ];

  return (
    <PageContainer className="max-w-5xl py-12 lg:py-16">
      <PageHeading eyebrow="Pica Pica" title="Settings" description="Local library, secure API keys, and video tools." />

      <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="bg-card/65">
          <CardHeader>
            <CardTitle>Local system</CardTitle>
            <CardDescription>Paths and tools Pica Pica uses on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="-mx-4">
            {rows.map(({ icon: Icon, label, value }, index) => (
              <Fragment key={label}>
                <Item role="listitem" className="gap-3.5 border-0 px-4 py-3.5">
                  <ItemMedia variant="icon" className="size-10 self-center! translate-y-0! rounded-xl border-0">
                    <Icon className="size-4 text-primary" />
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0.5">
                    <ItemTitle className="font-semibold leading-4">{label}</ItemTitle>
                    <ItemDescription className="line-clamp-none break-all text-xs leading-4">{value}</ItemDescription>
                  </ItemContent>
                </Item>
                {index < rows.length - 1 ? <ItemSeparator className="mx-4 w-auto" /> : null}
              </Fragment>
            ))}
            </ItemGroup>
          </CardContent>
        </Card>

        <Card className="bg-card/65">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-muted"><KeyRound className="size-4" /></div>
              <div><CardTitle>Online metadata</CardTitle><CardDescription>Optional game matching and artwork. These providers do not import your Steam library.</CardDescription></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <ProviderKeyForm
              provider="RAWG"
              configured={providerSettings?.rawgConfigured ?? false}
              value={rawgKey}
              onChange={setRawgKey}
              saving={saving === "rawg"}
              onSubmit={(event) => void saveKey(event, "rawg")}
              onOpenHelp={() => void openProviderPage("https://rawg.io/apidocs")}
              helpUrl="https://rawg.io/apidocs"
            />
            <Separator />
            <ProviderKeyForm
              provider="SteamGridDB"
              configured={providerSettings?.steamGridDbConfigured ?? false}
              value={steamGridKey}
              onChange={setSteamGridKey}
              saving={saving === "steamgriddb"}
              onSubmit={(event) => void saveKey(event, "steamgriddb")}
              onOpenHelp={() => void openProviderPage("https://www.steamgriddb.com/profile/preferences/api")}
              helpUrl="https://www.steamgriddb.com/profile/preferences/api"
            />
            <Alert>
              <ShieldCheck className="mt-0.5 size-4" />
              <AlertTitle>No keys in SQLite or Git</AlertTitle>
              <AlertDescription>Keys are stored by Windows Credential Manager, macOS Keychain, or Linux Secret Service.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      {notice ? <Alert className="mt-6"><CheckCircle2 className="mt-0.5 size-4" /><AlertTitle>Saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive" className="mt-6"><KeyRound className="mt-0.5 size-4" /><AlertTitle>Action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </PageContainer>
  );
}

function ProviderKeyForm({ provider, configured, value, onChange, saving, onSubmit, onOpenHelp, helpUrl }: {
  provider: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
  onOpenHelp: () => void;
  helpUrl: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Field className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor={`${provider}-key`}>{provider} API key</FieldLabel>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {configured ? <><CheckCircle2 className="size-3 text-white" /> Configured</> : "Not configured"}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`${provider}-key`} type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} placeholder={configured ? "Replace existing key" : "Paste API key"} />
          <Button type="submit" variant="secondary" disabled={!value.trim() || saving}>
            {saving ? <Spinner /> : <KeyRound className="size-4" />} Save
          </Button>
        </div>
        <div>
          <Button type="button" variant="ghost" size="sm" className="-ml-3 text-muted-foreground" onClick={onOpenHelp} aria-label={`Open ${provider} API key page`} title={helpUrl}>
            Get an API key from {provider} <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </Field>
    </form>
  );
}
