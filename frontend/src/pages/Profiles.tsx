import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { CheckCircle2, Clock3, Layers3, RefreshCw, Sparkles, Trash2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import {
  activateProfile,
  copyProfileItems,
  createProfile,
  deleteProfile,
  getCurrentProfile,
  listGroups,
  listProfileRevisions,
  listProfiles,
  listProxies,
  listRules,
  updateProfile,
} from "@/lib/api"
import { formatUiDate } from "@/lib/dates"
import type { Profile, ProxyConfig, ProxyGroup, Revision, RuleEntry } from "@/lib/api"

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activatingId, setActivatingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [copying, setCopying] = useState(false)

  const [externalController, setExternalController] = useState("")
  const [externalUi, setExternalUi] = useState("")
  const [secret, setSecret] = useState("")
  const [mixedPort, setMixedPort] = useState("")
  const [allowLan, setAllowLan] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [cloneFromProfileId, setCloneFromProfileId] = useState<number | null>(null)
  const [activateAfterCreate, setActivateAfterCreate] = useState(false)
  const [copySourceProfileId, setCopySourceProfileId] = useState<number | null>(null)
  const [sourceProxies, setSourceProxies] = useState<ProxyConfig[]>([])
  const [sourceGroups, setSourceGroups] = useState<ProxyGroup[]>([])
  const [sourceRules, setSourceRules] = useState<RuleEntry[]>([])
  const [selectedProxyIds, setSelectedProxyIds] = useState<number[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
  const [selectedRuleIds, setSelectedRuleIds] = useState<number[]>([])

  const loadProfiles = async (profileId?: number | null) => {
    const [current, list] = await Promise.all([getCurrentProfile(), listProfiles()])
    setCurrentProfile(current)
    setProfiles(list)
    const nextSelectedProfileId = profileId ?? selectedProfileId ?? current.id
    setSelectedProfileId(nextSelectedProfileId)
    const revisionList = await listProfileRevisions(nextSelectedProfileId)
    setRevisions(revisionList)
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadProfiles()
      } catch {
        toast.error("Failed to load profiles")
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    if (selectedProfileId == null) {
      return
    }
    const run = async () => {
      try {
        const revisionList = await listProfileRevisions(selectedProfileId)
        setRevisions(revisionList)
      } catch {
        toast.error("Failed to load revision history")
      }
    }
    run()

    const profile = profiles.find((p) => p.id === selectedProfileId)
    if (profile) {
      setExternalController(profile.external_controller || "")
      setExternalUi(profile.external_ui || "")
      setSecret(profile.secret || "")
      setMixedPort(profile.mixed_port ? String(profile.mixed_port) : "")
      setAllowLan(profile.allow_lan || false)
    }
  }, [selectedProfileId, profiles])

  useEffect(() => {
    if (!copySourceProfileId) {
      setSourceProxies([])
      setSourceGroups([])
      setSourceRules([])
      setSelectedProxyIds([])
      setSelectedGroupIds([])
      setSelectedRuleIds([])
      return
    }

    const run = async () => {
      try {
        const [proxies, groups, rules] = await Promise.all([
          listProxies(copySourceProfileId),
          listGroups(copySourceProfileId),
          listRules(copySourceProfileId),
        ])
        setSourceProxies(proxies)
        setSourceGroups(groups)
        setSourceRules(rules)
        setSelectedProxyIds([])
        setSelectedGroupIds([])
        setSelectedRuleIds([])
      } catch {
        toast.error("Failed to load source profile items")
      }
    }

    run()
  }, [copySourceProfileId])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadProfiles(selectedProfileId)
      toast.success("Profiles refreshed")
    } catch {
      toast.error("Failed to refresh profiles")
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.error("Profile name is required")
      return
    }

    try {
      setCreating(true)
      const created = await createProfile({
        name: name.trim(),
        description: description.trim() || undefined,
        clone_from_profile_id: cloneFromProfileId,
        activate_after_create: activateAfterCreate,
      })
      await loadProfiles(created.id)
      setName("")
      setDescription("")
      setCloneFromProfileId(null)
      setActivateAfterCreate(false)
      toast.success("Profile created")
    } catch {
      toast.error("Failed to create profile")
    } finally {
      setCreating(false)
    }
  }

  const handleActivate = async (profileId: number) => {
    try {
      setActivatingId(profileId)
      await activateProfile(profileId)
      await loadProfiles(profileId)
      toast.success("Active profile updated")
    } catch {
      toast.error("Failed to activate profile")
    } finally {
      setActivatingId(null)
    }
  }

  const handleDelete = async (profile: Profile) => {
    if (profile.is_active || profile.is_default) {
      toast.error("Activate another non-default profile before deleting this one")
      return
    }
    if (!window.confirm(`Delete profile "${profile.name}"? This removes its devices, revisions, and config data.`)) {
      return
    }

    try {
      setDeletingId(profile.id)
      await deleteProfile(profile.id)
      await loadProfiles(currentProfile?.id)
      toast.success("Profile deleted")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to delete profile")
    } finally {
      setDeletingId(null)
    }
  }

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId) return
    try {
      setSavingSettings(true)
      await updateProfile(selectedProfileId, {
        external_controller: externalController.trim() || null,
        external_ui: externalUi.trim() || null,
        secret: secret.trim() || null,
        mixed_port: mixedPort ? Number(mixedPort) : null,
        allow_lan: allowLan,
      })
      await loadProfiles(selectedProfileId)
      toast.success("Profile settings updated")
    } catch {
      toast.error("Failed to update profile settings")
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleSelection = (
    value: number,
    current: number[],
    setter: (next: number[]) => void,
  ) => {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  const handleCopyItems = async () => {
    if (!selectedProfileId || !copySourceProfileId) {
      toast.error("Select both a target and a source profile first")
      return
    }
    if (
      selectedProxyIds.length === 0 &&
      selectedGroupIds.length === 0 &&
      selectedRuleIds.length === 0
    ) {
      toast.error("Choose at least one proxy, group, or rule to copy")
      return
    }

    try {
      setCopying(true)
      const result = await copyProfileItems(selectedProfileId, {
        source_profile_id: copySourceProfileId,
        proxy_ids: selectedProxyIds,
        group_ids: selectedGroupIds,
        rule_ids: selectedRuleIds,
      })
      await loadProfiles(selectedProfileId)
      toast.success(
        `Copied ${result.copied_proxy_count} proxies, ${result.copied_group_count} groups, and ${result.copied_rule_count} rules`,
      )
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to copy selected items")
    } finally {
      setCopying(false)
    }
  }

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? currentProfile
  const publishedRevision = revisions.find((revision) => revision.status === "published")
  const draftRevision = revisions.find((revision) => revision.status === "draft")

  return (
    <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden border-white/10 bg-white/6 backdrop-blur">
          <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <Badge className="theme-accent-badge w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
                Profile Matrix
              </Badge>
              <div>
                <CardTitle className="text-3xl text-white">Profiles and Releases</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-sm text-slate-300">
                  Switch the active config, compare revision history, and stage
                  clean release lanes for different devices.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/8 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/70">
                Active Profile
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {currentProfile?.name ?? "Loading"}
              </div>
              <div className="mt-2 text-sm text-emerald-50/70">
                {currentProfile?.slug ? `Slug: ${currentProfile.slug}` : "Waiting for backend"}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-300">
                Published Revision
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {publishedRevision ? `v${publishedRevision.version}` : "None"}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {formatUiDate(publishedRevision?.published_at, "Not published yet")}
              </div>
            </div>
            <div className="rounded-3xl border border-amber-300/15 bg-amber-300/8 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-amber-100/70">
                Draft Head
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {draftRevision ? `v${draftRevision.version}` : "Clean"}
              </div>
              <div className="mt-2 text-sm text-amber-50/70">
                {draftRevision?.change_summary || "No unpublished draft snapshot"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0f172dcc] text-white backdrop-blur">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-rose-400/15 p-3 text-rose-100">
                <Sparkles className="size-5" />
              </div>
              <div>
                <CardTitle>Create Profile</CardTitle>
                <CardDescription className="mt-1 text-slate-300">
                  Start a new environment for a region, device class, or client.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateProfile}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Profile name"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this profile for?"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
              />
              <select
                value={cloneFromProfileId ?? ""}
                onChange={(event) =>
                  setCloneFromProfileId(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="" className="bg-slate-950">
                  Start empty
                </option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id} className="bg-slate-950">
                    Clone from {profile.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={activateAfterCreate}
                  onChange={(event) => setActivateAfterCreate(event.target.checked)}
                  className="size-4 rounded border-white/20 bg-slate-950"
                />
                Make this profile active after creation
              </label>
              <Button
                type="submit"
                className="theme-accent-button w-full rounded-xl"
                disabled={creating}
              >
                {creating
                  ? "Creating..."
                  : cloneFromProfileId
                    ? "Clone profile"
                    : "Create profile"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-[#091426cc] text-white backdrop-blur">
          <CardHeader>
            <CardTitle>Managed Profiles</CardTitle>
            <CardDescription className="text-slate-300">
              Select a profile to inspect revisions or switch it live.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {loading ? (
              <div className="col-span-full rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-400">
                Loading profiles...
              </div>
            ) : (
              profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={`rounded-3xl border p-5 text-left transition ${
                      selectedProfileId === profile.id
                      ? "theme-accent-active"
                      : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8"
                    }`}
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-white">{profile.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {profile.slug}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {profile.is_active && (
                        <Badge className="rounded-full bg-emerald-400/15 text-emerald-100">
                          Active
                        </Badge>
                      )}
                      {profile.is_default && (
                        <Badge className="rounded-full bg-white/10 text-white">
                          Default
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-4 min-h-10 text-sm text-slate-300">
                    {profile.description || "No description set for this environment."}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-300">
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Nodes
                      </div>
                      <div className="mt-2 text-base font-semibold text-white">
                        {profile.proxy_count ?? 0}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Rules
                      </div>
                      <div className="mt-2 text-base font-semibold text-white">
                        {profile.rule_count ?? 0}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Devices
                      </div>
                      <div className="mt-2 text-base font-semibold text-white">
                        {profile.device_count ?? 0}
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-400">
                      Updated {formatUiDate(profile.updated_at)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                        disabled={profile.is_active || profile.is_default || deletingId === profile.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(profile)
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-full bg-white text-slate-950 hover:bg-slate-100"
                        disabled={profile.is_active || activatingId === profile.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleActivate(profile.id)
                        }}
                      >
                        {activatingId === profile.id ? "Switching..." : "Make active"}
                      </Button>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selectedProfile && (
        <Card className="border-white/10 bg-[#101827d6] text-white backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="theme-accent-icon size-5" />
                Global / External Config Settings
              </CardTitle>
              <CardDescription className="text-slate-300">
                Configure external controller UI and global properties for {selectedProfile.name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveSettings} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-200">External Controller</label>
                  <Input value={externalController} onChange={e => setExternalController(e.target.value)} placeholder="127.0.0.1:9090" className="border-white/10 bg-black/20 text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-200">External UI</label>
                  <Input value={externalUi} onChange={e => setExternalUi(e.target.value)} placeholder="ui" className="border-white/10 bg-black/20 text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-200">Secret Token</label>
                  <Input value={secret} onChange={e => setSecret(e.target.value)} placeholder="your_secret" className="border-white/10 bg-black/20 text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-200">Mixed Port</label>
                  <Input type="number" value={mixedPort} onChange={e => setMixedPort(e.target.value)} placeholder="7890" className="border-white/10 bg-black/20 text-white" />
                </div>
                <div className="space-y-2 md:col-span-2 flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={allowLan}
                    onChange={(e) => setAllowLan(e.target.checked)}
                    className="size-4 rounded border-white/20 bg-slate-950"
                    id="allow-lan"
                  />
                  <label htmlFor="allow-lan" className="text-sm text-slate-200 cursor-pointer">Allow LAN Connections</label>
                </div>
                <div className="md:col-span-2">
                  <Button
                    type="submit"
                    className="theme-accent-button"
                    disabled={savingSettings}
                  >
                    {savingSettings ? "Saving..." : "Save Config Settings"}
                  </Button>
                </div>
              </form>
            </CardContent>
        </Card>
        )}

        <div className="space-y-6">
          <Card className="border-white/10 bg-[#101827d6] text-white backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="theme-accent-icon size-5" />
                Copy From Profile
              </CardTitle>
              <CardDescription className="text-slate-300">
                Import selected proxies, groups, and rules into {selectedProfile?.name || "the selected profile"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <select
                value={copySourceProfileId ?? ""}
                onChange={(event) =>
                  setCopySourceProfileId(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="" className="bg-slate-950">
                  Select source profile
                </option>
                {profiles
                  .filter((profile) => profile.id !== selectedProfileId)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id} className="bg-slate-950">
                      {profile.name}
                    </option>
                  ))}
              </select>

              {copySourceProfileId ? (
                <div className="grid gap-4">
                  <SelectionBlock
                    title="Proxies"
                    items={sourceProxies.map((proxy) => ({
                      id: proxy.id || 0,
                      label: proxy.name,
                      meta: `${proxy.type} • ${proxy.server}:${proxy.port}`,
                    }))}
                    selectedIds={selectedProxyIds}
                    onToggle={(id) =>
                      toggleSelection(id, selectedProxyIds, setSelectedProxyIds)
                    }
                  />
                  <SelectionBlock
                    title="Groups"
                    items={sourceGroups.map((group) => ({
                      id: group.id,
                      label: group.name,
                      meta: `${group.type} • ${group.members.length} members`,
                    }))}
                    selectedIds={selectedGroupIds}
                    onToggle={(id) =>
                      toggleSelection(id, selectedGroupIds, setSelectedGroupIds)
                    }
                  />
                  <SelectionBlock
                    title="Rules"
                    items={sourceRules.map((rule) => ({
                      id: rule.id,
                      label: rule.payload,
                      meta: `${rule.type} -> ${rule.target}${rule.comment ? ` • ${rule.comment}` : ""}`,
                    }))}
                    selectedIds={selectedRuleIds}
                    onToggle={(id) =>
                      toggleSelection(id, selectedRuleIds, setSelectedRuleIds)
                    }
                  />
                  <Button
                    className="theme-accent-button"
                    disabled={copying}
                    onClick={() => void handleCopyItems()}
                  >
                    {copying ? "Copying..." : "Copy selected items"}
                  </Button>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
                  Choose a source profile to browse its proxies, groups, and rules.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#101827d6] text-white backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="theme-accent-icon size-5" />
                Release Timeline
              </CardTitle>
              <CardDescription className="text-slate-300">
                {selectedProfile
                  ? `Revision history for ${selectedProfile.name}`
                  : "Pick a profile to inspect revisions."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {revisions.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-400">
                  No revisions recorded for this profile yet.
                </div>
              ) : (
                revisions.slice(0, 8).map((revision) => (
                  <div
                    key={revision.id}
                    className="rounded-3xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                          {revision.status === "published" ? (
                            <CheckCircle2 className="size-4 text-emerald-300" />
                          ) : (
                            <Clock3 className="size-4 text-amber-300" />
                          )}
                          <span className="uppercase tracking-[0.22em]">
                            {revision.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xl font-semibold text-white">
                          Revision v{revision.version}
                        </div>
                      </div>
                      <Badge className="rounded-full bg-white/10 text-slate-100">
                        {revision.source}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">
                      {revision.change_summary || "No change summary provided."}
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                      <span>Created {formatUiDate(revision.created_at)}</span>
                      <span>
                        {revision.published_at
                          ? `Published ${formatUiDate(revision.published_at)}`
                          : "Not published"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}

function SelectionBlock({
  title,
  items,
  selectedIds,
  onToggle,
}: {
  title: string
  items: Array<{ id: number; label: string; meta: string }>
  selectedIds: number[]
  onToggle: (id: number) => void
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-xs uppercase tracking-[0.24em] text-slate-400">{title}</div>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
            Nothing available in this category.
          </div>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
                className="mt-0.5 size-4 rounded border-white/20 bg-slate-950"
              />
              <div>
                <div className="font-medium text-white">{item.label}</div>
                <div className="mt-1 text-xs text-slate-400">{item.meta}</div>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
