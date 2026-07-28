import { GitFork, Library, Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { PicaMark } from "@/components/brand/PicaMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header
        data-app-header
        className="sticky top-0 z-40 border-b border-white/[.07] bg-background/88 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-[68px] max-w-[3200px] items-center gap-7 px-5 sm:px-8 lg:px-10">
          <NavLink to="/library" aria-label="Pica Pica library" className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <PicaMark />
            <span className="hidden text-[15px] font-black tracking-[-.035em] sm:block">PICA PICA</span>
          </NavLink>
          <nav className="flex h-full items-center gap-1" aria-label="Main navigation">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    "relative flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary/70",
                    isActive ? "text-white" : "text-muted-foreground hover:bg-white/[.045] hover:text-white",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="size-4" />
                    <span className="hidden sm:inline">{label}</span>
                    {isActive ? <span className="absolute inset-x-3 -bottom-[15px] h-px bg-primary shadow-[0_0_10px_rgba(255,255,255,.7)]" /> : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Project on GitHub" disabled>
              <GitFork className="size-[18px]" />
            </Button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
