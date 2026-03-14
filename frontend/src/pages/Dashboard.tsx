import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Cpu,
  LaptopMinimalCheck,
  Layers3,
  RefreshCw,
  Rocket,
  ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import api, {
  getCurrentProfile,
  listDevices,
  listProfileRevisions,
  listProfiles,
  publishProfile,
  rollbackRevision,
  validateProfile,
} from "@/lib/api"
import { formatUiDate } from "@/lib/dates"
import type { Profile, Revision, ValidationResult } from "@/lib/api"

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [rollingBackId, setRollingBackId] = useState<number | null>(null)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [deviceCount, setDeviceCount] = useState(0)
  const [stats, setStats] = useState({ proxies: 0, groups: 0, rules: 0 })

  const loadDashboard = async () => {
    const current = await getCurrentProfile()
    const [profileList, revisionList, validationResult, devices, proxies, groups, rules] =
      await Promise.all([
        listProfiles(),
        listProfileRevisions(current.id),
        validateProfile(current.id),
        listDevices(current.id),
        api.get("/proxies", { params: { profile_id: current.id } }),
        api.get("/groups", { params: { profile_id: current.id } }),
        api.get("/rules", { params: { profile_id: current.id } }),
      ])

    setCurrentProfile(current)
    setProfiles(profileList)
    setRevisions(revisionList)
    setValidation(validationResult)
    setDeviceCount(devices.length)
    setStats({
      proxies: proxies.data.length,
      groups: groups.data.length,
      rules: rules.data.length,
    })
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadDashboard()
      } catch {
        toast.error("Failed to load dashboard")
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadDashboard()
      toast.success("Dashboard refreshed")
    } catch {
      toast.error("Failed to refresh dashboard")
    } finally {
      setRefreshing(false)
    }
  }

  const handlePublish = async () => {
    if (!currentProfile) {
      return
    }
    try {
      setPublishing(true)
      await publishProfile(currentProfile.id, {
        source: "dashboard",
        change_summary: "Published from release overview",
      })
      await loadDashboard()
      toast.success("Revision published")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to publish profile")
    } finally {
      setPublishing(false)
    }
  }

  const handleRollback = async (revisionId: number) => {
    try {
      setRollingBackId(revisionId)
      await rollbackRevision(revisionId)
      await loadDashboard()
      toast.success("Rollback complete")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to rollback revision")
    } finally {
      setRollingBackId(null)
    }
  }

  const publishedRevision = revisions.find((revision) => revision.status === "published")
  const draftRevision = revisions.find((revision) => revision.status === "draft")
  const archivedRevisions = revisions.filter((revision) => revision.status !== "draft")

  return (
    <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="theme-hero relative overflow-hidden rounded-[32px] border border-white/10 p-8 text-white shadow-2xl">
        <div className="theme-hero-glow absolute inset-y-0 right-0 hidden w-1/3 lg:block" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-5">
            <Badge className="theme-accent-badge rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
              Release Control
            </Badge>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Build, publish, and ship Clash profiles without losing release context.
              </h1>
              <p className="max-w-2xl text-base text-slate-300 md:text-lg">
                The dashboard now centers on the active profile, its revision
                history, and the device fleet consuming tokenized subscription links.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                Active profile: <strong className="ml-1 text-white">{currentProfile?.name ?? "Loading"}</strong>
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                Published revision: <strong className="ml-1 text-white">
                  {publishedRevision ? `v${publishedRevision.version}` : "None"}
                </strong>
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:w-[24rem]">
            <Button
              className="theme-accent-button h-12 rounded-2xl"
              onClick={handlePublish}
              disabled={publishing || !currentProfile}
            >
              <Rocket />
              {publishing ? "Publishing..." : "Publish active profile"}
            </Button>
            <Button
              variant="outline"
              className="h-12 rounded-2xl border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              Refresh data
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-white/10 bg-[#0d1829cc] text-white backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Profiles</CardDescription>
            <CardTitle className="flex items-center justify-between text-3xl">
              {profiles.length}
              <Layers3 className="theme-accent-icon size-6" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            Separate release lanes for environments and device groups.
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#111827d1] text-white backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Nodes</CardDescription>
            <CardTitle className="flex items-center justify-between text-3xl">
              {stats.proxies}
              <Cpu className="size-6 text-amber-200" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            {stats.groups} groups and {stats.rules} rules in the active profile.
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#0d1524d6] text-white backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Devices</CardDescription>
            <CardTitle className="flex items-center justify-between text-3xl">
              {deviceCount}
              <LaptopMinimalCheck className="size-6 text-emerald-200" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            Registered clients consuming tokenized subscription links.
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#171127d4] text-white backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Validation</CardDescription>
            <CardTitle className="flex items-center justify-between text-3xl">
              {validation?.valid ? "Ready" : "Attention"}
              {validation?.valid ? (
                <CheckCircle2 className="size-6 text-emerald-200" />
              ) : (
                <ShieldAlert className="size-6 text-rose-200" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            {validation?.errors?.length
              ? `${validation.errors.length} blocking issue(s)`
              : validation?.warnings?.length
                ? `${validation.warnings.length} warning(s)`
                : "No issues reported for the active profile"}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-white/10 bg-[#0b1220d8] text-white backdrop-blur">
          <CardHeader>
            <CardTitle>Release Readiness</CardTitle>
            <CardDescription className="text-slate-300">
              Publish only when the active profile passes validation and the draft state is intentional.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Active Profile
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {currentProfile?.name ?? "Loading"}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {currentProfile?.description || "No description set yet."}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/8 p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/70">
                  Published
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">
                  {publishedRevision ? `v${publishedRevision.version}` : "None"}
                </div>
                <div className="mt-2 text-sm text-emerald-50/70">
                  {formatUiDate(publishedRevision?.published_at)}
                </div>
              </div>
              <div className="rounded-3xl border border-amber-300/15 bg-amber-300/8 p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-amber-100/70">
                  Draft
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">
                  {draftRevision ? `v${draftRevision.version}` : "Clean"}
                </div>
                <div className="mt-2 text-sm text-amber-50/70">
                  {draftRevision?.change_summary || "No draft snapshot recorded"}
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Validation Report
              </div>
              {loading ? (
                <div className="mt-4 text-sm text-slate-400">Loading validation state...</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {(validation?.errors || []).map((error) => (
                    <div
                      key={error}
                      className="rounded-2xl border border-rose-300/15 bg-rose-400/8 p-3 text-sm text-rose-100"
                    >
                      {error}
                    </div>
                  ))}
                  {(validation?.warnings || []).map((warning) => (
                    <div
                      key={warning}
                      className="rounded-2xl border border-amber-300/15 bg-amber-300/8 p-3 text-sm text-amber-100"
                    >
                      {warning}
                    </div>
                  ))}
                  {!validation?.errors?.length && !validation?.warnings?.length && (
                    <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/8 p-3 text-sm text-emerald-100">
                      No validation issues found for the active profile.
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#111827d6] text-white backdrop-blur">
          <CardHeader>
            <CardTitle>Revision Timeline</CardTitle>
            <CardDescription className="text-slate-300">
              Publish and rollback controls live directly beside the release history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {revisions.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-400">
                No revisions have been recorded yet.
              </div>
            ) : (
              archivedRevisions.slice(0, 6).map((revision) => (
                <div
                  key={revision.id}
                  className="rounded-3xl border border-white/10 bg-black/20 p-5"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={`rounded-full ${
                            revision.status === "published"
                              ? "bg-emerald-400/15 text-emerald-100"
                              : "bg-white/10 text-slate-200"
                          }`}
                        >
                          {revision.status}
                        </Badge>
                        <Badge className="rounded-full bg-white/10 text-slate-200">
                          {revision.source}
                        </Badge>
                      </div>
                      <div className="mt-3 text-2xl font-semibold text-white">
                        Revision v{revision.version}
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {revision.change_summary || "No summary provided."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>Created {formatUiDate(revision.created_at)}</span>
                        <span>Published {formatUiDate(revision.published_at)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => void handleRollback(revision.id)}
                      disabled={rollingBackId === revision.id}
                    >
                      {rollingBackId === revision.id ? "Rolling back..." : "Rollback to this"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
