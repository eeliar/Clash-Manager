import { useEffect, useState } from "react"
import type { ChangeEvent, FormEvent, ReactNode } from "react"
import {
  Activity,
  ArrowUpDown,
  FileUp,
  LayoutGrid,
  Link2,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldAlert,
  TableProperties,
  Trash,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createProxy,
  createSource,
  deleteProxy,
  deleteSource,
  getCurrentProfile,
  importSs,
  importVless,
  importWireguard,
  listSources,
  listProfiles,
  listProxies,
  syncSource,
  triggerProxyLatencyTest,
  updateProxy,
  updateSource,
} from "@/lib/api"
import { formatUiDate } from "@/lib/dates"
import type { Profile, ProxyConfig, SubscriptionSource } from "@/lib/api"

type ProxyViewMode = "minimal" | "expanded" | "table"
type ProxySortKey = "name" | "latency" | "status"
type ProxyStatusFilter = "all" | "online" | "offline" | "unknown"
type SortDirection = "asc" | "desc"

const defaultAwgOptions = {
  awg_jc: 32,
  awg_jmin: 64,
  awg_jmax: 256,
  awg_s1: 0,
  awg_s2: 0,
  awg_h1: 1,
  awg_h2: 2,
  awg_h3: 3,
  awg_h4: 4,
}

const defaultProxyForm = (profileId?: number | null): ProxyConfig => ({
  profile_id: profileId ?? undefined,
  name: "",
  type: "vless",
  server: "",
  port: 443,
  uuid: "",
  tls: true,
  udp: true,
  network: "tcp",
  public_key: "",
  short_id: "",
  fingerprint: "chrome",
  cipher: "aes-256-gcm",
  password: "",
  sni: "",
  private_key: "",
  ip_address: "",
  dns_servers: "",
  mtu: 1280,
  ...defaultAwgOptions,
})

const viewModes: Array<{ value: ProxyViewMode; label: string; icon: typeof LayoutGrid }> = [
  { value: "minimal", label: "Minimal", icon: List },
  { value: "expanded", label: "Expanded", icon: LayoutGrid },
  { value: "table", label: "Table", icon: TableProperties },
]

function getStatusTone(status?: string) {
  if (status === "online") {
    return "bg-emerald-400"
  }
  if (status === "offline") {
    return "bg-rose-400"
  }
  return "bg-slate-500"
}

function getStatusLabel(status?: string) {
  if (status === "online") {
    return "online"
  }
  if (status === "offline") {
    return "offline"
  }
  return "unknown"
}

function getStatusRank(status?: string) {
  if (status === "online") {
    return 0
  }
  if (status === "unknown" || !status) {
    return 1
  }
  return 2
}

function getLatencyValue(proxy: ProxyConfig) {
  if (proxy.latency == null || proxy.status === "unknown") {
    return Number.POSITIVE_INFINITY
  }
  return proxy.latency
}

function formatLatency(proxy: ProxyConfig) {
  if (proxy.latency != null && proxy.status !== "unknown") {
    return `${proxy.latency} ms`
  }
  return "unknown latency"
}

function isValidWireguardKey(value?: string | null) {
  if (!value?.trim()) {
    return false
  }

  try {
    const normalized = value.trim()
    const decoded = atob(normalized)
    return decoded.length === 32
  } catch {
    return false
  }
}

function getProxyIssues(proxy: ProxyConfig) {
  const issues: string[] = []

  if (!proxy.name.trim()) {
    issues.push("Missing proxy name")
  }
  if (!proxy.server.trim()) {
    issues.push("Missing server address")
  }
  if (!Number.isFinite(proxy.port) || proxy.port <= 0 || proxy.port > 65535) {
    issues.push("Invalid port")
  }

  if (proxy.type === "vless" && !(proxy.uuid || "").trim()) {
    issues.push("Missing UUID")
  }

  if (proxy.type === "ss") {
    if (!(proxy.cipher || "").trim()) {
      issues.push("Missing cipher")
    }
    if (!(proxy.password || "").trim()) {
      issues.push("Missing password")
    }
  }

  if (proxy.type === "wireguard") {
    if (!isValidWireguardKey(proxy.private_key)) {
      issues.push("Invalid private key")
    }
    if (!isValidWireguardKey(proxy.public_key)) {
      issues.push("Invalid public key")
    }
    if (!(proxy.ip_address || "").trim()) {
      issues.push("Missing interface address")
    }
  }

  return issues
}

function compareProxies(
  left: ProxyConfig,
  right: ProxyConfig,
  sortKey: ProxySortKey,
  direction: SortDirection,
) {
  let comparison = 0

  if (sortKey === "name") {
    comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  } else if (sortKey === "latency") {
    comparison = getLatencyValue(left) - getLatencyValue(right)
    if (comparison === 0) {
      comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    }
  } else {
    comparison = getStatusRank(left.status) - getStatusRank(right.status)
    if (comparison === 0) {
      comparison = getLatencyValue(left) - getLatencyValue(right)
    }
  }

  return direction === "asc" ? comparison : comparison * -1
}

function ProxyEditor({
  value,
  onChange,
}: {
  value: ProxyConfig
  onChange: (next: ProxyConfig) => void
}) {
  const setField = <K extends keyof ProxyConfig>(field: K, next: ProxyConfig[K]) => {
    onChange({ ...value, [field]: next })
  }

  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={value.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="Node label"
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <select
            value={value.type}
            onChange={(event) => setField("type", event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="vless">vless</option>
            <option value="ss">ss</option>
            <option value="wireguard">wireguard</option>
          </select>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Server</Label>
          <Input
            value={value.server}
            onChange={(event) => setField("server", event.target.value)}
            placeholder="server.example.com"
          />
        </div>
        <div className="space-y-2">
          <Label>Port</Label>
          <Input
            type="number"
            value={String(value.port)}
            onChange={(event) => setField("port", Number(event.target.value) || 0)}
          />
        </div>
      </div>
      {value.type === "vless" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>UUID / Client ID</Label>
              <Input
                value={value.uuid || ""}
                onChange={(event) => setField("uuid", event.target.value)}
                placeholder="UUID for VLESS"
              />
            </div>
            <div className="space-y-2">
              <Label>Network</Label>
              <Input
                value={value.network || ""}
                onChange={(event) => setField("network", event.target.value)}
                placeholder="tcp, ws, grpc..."
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>SNI</Label>
              <Input
                value={value.sni || ""}
                onChange={(event) => setField("sni", event.target.value)}
                placeholder="example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Fingerprint</Label>
              <Input
                value={value.fingerprint || ""}
                onChange={(event) => setField("fingerprint", event.target.value)}
                placeholder="chrome"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Public Key</Label>
              <Input
                value={value.public_key || ""}
                onChange={(event) => setField("public_key", event.target.value)}
                placeholder="REALITY public key"
              />
            </div>
            <div className="space-y-2">
              <Label>Short ID</Label>
              <Input
                value={value.short_id || ""}
                onChange={(event) => setField("short_id", event.target.value)}
                placeholder="Optional short id"
              />
            </div>
          </div>
        </>
      ) : null}
      {value.type === "ss" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Cipher</Label>
            <Input
              value={value.cipher || ""}
              onChange={(event) => setField("cipher", event.target.value)}
              placeholder="aes-256-gcm"
            />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input
              value={value.password || ""}
              onChange={(event) => setField("password", event.target.value)}
              placeholder="Secret"
            />
          </div>
        </div>
      ) : null}
      {value.type === "wireguard" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Private Key</Label>
              <Input
                value={value.private_key || ""}
                onChange={(event) => setField("private_key", event.target.value)}
                placeholder="Private key"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={value.ip_address || ""}
                onChange={(event) => setField("ip_address", event.target.value)}
                placeholder="10.0.0.2/32"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>DNS Servers</Label>
              <Input
                value={value.dns_servers || ""}
                onChange={(event) => setField("dns_servers", event.target.value)}
                placeholder="162.252.172.57,149.154.159.92"
              />
            </div>
            <div className="space-y-2">
              <Label>MTU</Label>
              <Input
                type="number"
                value={String(value.mtu ?? 1280)}
                onChange={(event) => setField("mtu", Number(event.target.value) || 1280)}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.22em] text-slate-500">
              AmneziaWG Options
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <AwgField label="jc" value={value.awg_jc} onChange={(next) => setField("awg_jc", next)} />
              <AwgField label="jmin" value={value.awg_jmin} onChange={(next) => setField("awg_jmin", next)} />
              <AwgField label="jmax" value={value.awg_jmax} onChange={(next) => setField("awg_jmax", next)} />
              <AwgField label="s1" value={value.awg_s1} onChange={(next) => setField("awg_s1", next)} />
              <AwgField label="s2" value={value.awg_s2} onChange={(next) => setField("awg_s2", next)} />
              <AwgField label="h1" value={value.awg_h1} onChange={(next) => setField("awg_h1", next)} />
              <AwgField label="h2" value={value.awg_h2} onChange={(next) => setField("awg_h2", next)} />
              <AwgField label="h3" value={value.awg_h3} onChange={(next) => setField("awg_h3", next)} />
              <AwgField label="h4" value={value.awg_h4} onChange={(next) => setField("awg_h4", next)} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Proxies() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingLatency, setTestingLatency] = useState(false)
  const [vlessModalOpen, setVlessModalOpen] = useState(false)
  const [ssModalOpen, setSsModalOpen] = useState(false)
  const [wgModalOpen, setWgModalOpen] = useState(false)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [editingProxy, setEditingProxy] = useState<ProxyConfig | null>(null)
  const [proxyForm, setProxyForm] = useState<ProxyConfig>(defaultProxyForm())
  const [vlessLink, setVlessLink] = useState("")
  const [ssLink, setSsLink] = useState("")
  const [wgFile, setWgFile] = useState<File | null>(null)
  const [sources, setSources] = useState<SubscriptionSource[]>([])
  const [editingSource, setEditingSource] = useState<SubscriptionSource | null>(null)
  const [sourceName, setSourceName] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [sourceActive, setSourceActive] = useState(true)
  const [savingSource, setSavingSource] = useState(false)
  const [syncingSourceId, setSyncingSourceId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ProxyViewMode>("expanded")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ProxyStatusFilter>("all")
  const [sortKey, setSortKey] = useState<ProxySortKey>("latency")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")

  const loadPage = async (profileId?: number | null) => {
    const [currentProfile, profileList] = await Promise.all([
      getCurrentProfile(),
      listProfiles(),
    ])
    const nextProfileId = profileId ?? selectedProfileId ?? currentProfile.id
    const [proxyList, sourceList] = await Promise.all([
      listProxies(nextProfileId),
      listSources(nextProfileId),
    ])
    setProfiles(profileList)
    setSelectedProfileId(nextProfileId)
    setProxies(proxyList)
    setSources(sourceList)
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadPage()
      } catch {
        toast.error("Failed to load proxies")
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    if (!selectedProfileId) {
      return
    }
    const run = async () => {
      try {
        const [proxyList, sourceList] = await Promise.all([
          listProxies(selectedProfileId),
          listSources(selectedProfileId),
        ])
        setProxies(proxyList)
        setSources(sourceList)
      } catch {
        toast.error("Failed to refresh proxies")
      }
    }
    run()
  }, [selectedProfileId])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadPage(selectedProfileId)
      toast.success("Proxy inventory refreshed")
    } catch {
      toast.error("Failed to refresh proxies")
    } finally {
      setRefreshing(false)
    }
  }

  const openCreateDialog = () => {
    setEditingProxy(null)
    setProxyForm(defaultProxyForm(selectedProfileId))
    setManualModalOpen(true)
  }

  const resetSourceForm = () => {
    setEditingSource(null)
    setSourceName("")
    setSourceUrl("")
    setSourceActive(true)
  }

  const openEditDialog = (proxy: ProxyConfig) => {
    setEditingProxy(proxy)
    setProxyForm({ ...defaultProxyForm(selectedProfileId), ...proxy })
    setManualModalOpen(true)
  }

  const handleSaveProxy = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId) {
      return
    }
    try {
      setSaving(true)
      const payload = { ...proxyForm, profile_id: selectedProfileId }
      if (editingProxy?.id) {
        await updateProxy(editingProxy.id, payload)
        toast.success("Proxy updated")
      } else {
        await createProxy(payload)
        toast.success("Proxy created")
      }
      setManualModalOpen(false)
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to save proxy")
    } finally {
      setSaving(false)
    }
  }

  const handleImportVless = async () => {
    if (!selectedProfileId || !vlessLink.trim()) {
      return
    }
    try {
      await importVless(vlessLink.trim(), selectedProfileId)
      toast.success("VLESS proxy imported")
      setVlessModalOpen(false)
      setVlessLink("")
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to import VLESS link")
    }
  }

  const handleImportWg = async () => {
    if (!selectedProfileId || !wgFile) {
      return
    }
    try {
      await importWireguard(wgFile, selectedProfileId)
      toast.success("WireGuard config imported")
      setWgModalOpen(false)
      setWgFile(null)
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to import WireGuard config")
    }
  }

  const handleImportSs = async () => {
    if (!selectedProfileId || !ssLink.trim()) {
      return
    }
    try {
      await importSs(ssLink.trim(), selectedProfileId)
      toast.success("Shadowsocks proxy imported")
      setSsModalOpen(false)
      setSsLink("")
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to import Shadowsocks link")
    }
  }

  const handleSaveSource = async () => {
    if (!selectedProfileId || !sourceName.trim() || !sourceUrl.trim()) {
      return
    }
    try {
      setSavingSource(true)
      if (editingSource) {
        await updateSource(editingSource.id, {
          name: sourceName.trim(),
          url: sourceUrl.trim(),
          is_active: sourceActive,
        })
        toast.success("Source updated")
      } else {
        const result = await createSource({
          profile_id: selectedProfileId,
          name: sourceName.trim(),
          url: sourceUrl.trim(),
          is_active: sourceActive,
        })
        toast.success(
          `Source synced: ${result.created} created, ${result.updated} updated, ${result.removed} removed`,
        )
      }
      resetSourceForm()
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to save source")
    } finally {
      setSavingSource(false)
    }
  }

  const handleEditSource = (source: SubscriptionSource) => {
    setEditingSource(source)
    setSourceName(source.name)
    setSourceUrl(source.url)
    setSourceActive(source.is_active)
  }

  const handleToggleSource = async (source: SubscriptionSource) => {
    try {
      setSyncingSourceId(source.id)
      await updateSource(source.id, {
        name: source.name,
        url: source.url,
        is_active: !source.is_active,
      })
      await loadPage(selectedProfileId)
      toast.success(source.is_active ? "Source disabled" : "Source enabled")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to update source")
    } finally {
      setSyncingSourceId(null)
    }
  }

  const handleSyncSource = async (sourceId: number, force = false) => {
    try {
      setSyncingSourceId(sourceId)
      const result = await syncSource(sourceId, force)
      await loadPage(selectedProfileId)
      const cacheLabel = result.used_cache ? "cached" : "fresh"
      toast.success(
        `Source ${cacheLabel}: ${result.created} created, ${result.updated} updated, ${result.removed} removed`,
      )
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to sync source")
    } finally {
      setSyncingSourceId(null)
    }
  }

  const handleDeleteSource = async (sourceId: number) => {
    if (!window.confirm("Delete this source and remove its imported proxies?")) {
      return
    }
    try {
      setSyncingSourceId(sourceId)
      await deleteSource(sourceId)
      await loadPage(selectedProfileId)
      toast.success("Source deleted")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to delete source")
    } finally {
      setSyncingSourceId(null)
    }
  }

  const handleDelete = async (proxyId: number) => {
    if (!window.confirm("Delete this proxy?")) {
      return
    }
    try {
      await deleteProxy(proxyId)
      toast.success("Proxy deleted")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    } catch {
      toast.error("Failed to delete proxy")
    }
  }

  const handleTestLatency = async () => {
    if (!selectedProfileId) {
      return
    }

    try {
      setTestingLatency(true)
      const summary = await triggerProxyLatencyTest(selectedProfileId)
      await loadPage(selectedProfileId)
      const methodLabel = summary.method === "mihomo-delay" ? "Mihomo delay API" : "TCP fallback"
      const delayLabel = summary.delay_url ? ` using ${summary.delay_url}` : ""
      toast.success(
        `Latency refreshed for ${summary.tested} proxies (${summary.online} online, ${summary.offline} offline) via ${methodLabel}${delayLabel}`,
      )
    } catch {
      toast.error("Failed to test proxy latency")
    } finally {
      setTestingLatency(false)
    }
  }

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    setWgFile(event.target.files?.[0] || null)
  }

  const handleSortChange = (nextSortKey: ProxySortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(nextSortKey)
    setSortDirection(nextSortKey === "latency" ? "asc" : "asc")
  }

  const filteredProxies = proxies
    .filter((proxy) => {
      const status = getStatusLabel(proxy.status)
      if (statusFilter !== "all" && status !== statusFilter) {
        return false
      }

      if (!searchQuery.trim()) {
        return true
      }

      const query = searchQuery.trim().toLowerCase()
      return [proxy.name, proxy.server, proxy.type, proxy.sni || ""].some((field) =>
        field.toLowerCase().includes(query),
      )
    })
    .sort((left, right) => compareProxies(left, right, sortKey, sortDirection))

  const onlineCount = proxies.filter((proxy) => proxy.status === "online").length
  const unknownCount = proxies.filter(
    (proxy) => getStatusLabel(proxy.status) === "unknown",
  ).length
  const invalidCount = proxies.filter((proxy) => getProxyIssues(proxy).length > 0).length

  return (
    <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="rounded-[32px] border border-white/10 bg-[#091424d8] p-8 text-white backdrop-blur">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Badge className="theme-accent-badge rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
              Node Builder
            </Badge>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">Proxy Composer</h1>
              <p className="mt-2 max-w-2xl text-slate-300">
                Import shared links, audit latency across the full node set, and switch between compact and detailed views while editing.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              value={selectedProfileId ?? ""}
              onChange={(event) => setSelectedProfileId(Number(event.target.value))}
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id} className="bg-slate-900">
                  {profile.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={handleRefresh}
              disabled={refreshing || testingLatency}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={handleTestLatency}
              disabled={testingLatency || !selectedProfileId}
            >
              <Activity className={testingLatency ? "animate-pulse" : ""} />
              {testingLatency ? "Testing all nodes..." : "Test latency"}
            </Button>
            <Button className="theme-accent-button" onClick={openCreateDialog}>
              <Plus />
              Add manual
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Dialog open={vlessModalOpen} onOpenChange={setVlessModalOpen}>
            <CardShell
              title="Import VLESS"
              description="Paste a share link and attach the node directly to the selected profile."
              action={
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                    <Link2 />
                    Open importer
                  </Button>
                </DialogTrigger>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import VLESS Proxy</DialogTitle>
                <DialogDescription>
                  The parsed node will be added to the currently selected profile.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <Label>VLESS Share Link</Label>
                <Input
                  value={vlessLink}
                  onChange={(event) => setVlessLink(event.target.value)}
                  placeholder="vless://..."
                />
              </div>
              <DialogFooter>
                <Button onClick={handleImportVless} disabled={!vlessLink.trim()}>
                  Import
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={ssModalOpen} onOpenChange={setSsModalOpen}>
            <CardShell
              title="Import Shadowsocks"
              description="Paste an `ss://` share link and turn it into a managed proxy record."
              action={
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                    <Link2 />
                    Import SS
                  </Button>
                </DialogTrigger>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Shadowsocks Proxy</DialogTitle>
                <DialogDescription>
                  The imported node will be added to the selected profile and renamed if needed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <Label>Shadowsocks Share Link</Label>
                <Input
                  value={ssLink}
                  onChange={(event) => setSsLink(event.target.value)}
                  placeholder="ss://..."
                />
              </div>
              <DialogFooter>
                <Button onClick={handleImportSs} disabled={!ssLink.trim()}>
                  Import
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={wgModalOpen} onOpenChange={setWgModalOpen}>
            <CardShell
              title="Upload WireGuard"
              description="Drop in a `.conf` file and translate it into a managed proxy record."
              action={
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                    <FileUp />
                    Upload file
                  </Button>
                </DialogTrigger>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import WireGuard Config</DialogTitle>
                <DialogDescription>
                  The uploaded config will become a managed proxy for the selected profile.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <Label>Configuration File</Label>
                <Input type="file" accept=".conf" onChange={handleFileSelect} />
              </div>
              <DialogFooter>
                <Button onClick={handleImportWg} disabled={!wgFile}>
                  Upload
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rounded-[28px] border border-white/10 bg-[#0e1828cc] p-5 text-white backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="theme-accent-frame rounded-2xl border p-3">
                <ServerCog className="size-5" />
              </div>
              <div>
                <div className="text-lg font-semibold">Subscription Sources</div>
                <div className="mt-1 text-sm text-slate-300">
                  Save upstream subscription URLs, sync them manually, and keep imported proxies source-owned.
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[0.7fr_1.2fr_auto]">
              <Input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="Source name"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              />
              <Input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://example.com/subscription.txt"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              />
              <Button
                type="button"
                className="theme-accent-button"
                disabled={savingSource || !sourceName.trim() || !sourceUrl.trim()}
                onClick={() => void handleSaveSource()}
              >
                {savingSource ? "Saving..." : editingSource ? "Save source" : "Add source"}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
                <input
                  type="checkbox"
                  checked={sourceActive}
                  onChange={(event) => setSourceActive(event.target.checked)}
                  className="size-4 rounded border-white/20 bg-slate-950"
                />
                Source active
              </label>
              {editingSource ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={resetSourceForm}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {sources.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                  No subscription sources saved for this profile yet.
                </div>
              ) : (
                sources.map((source) => (
                  <div
                    key={source.id}
                    className="rounded-2xl border border-white/10 bg-black/15 p-4"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-white">{source.name}</div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                            {source.is_active ? "active" : "disabled"}
                          </span>
                        </div>
                        <div className="mt-2 break-all font-mono text-xs text-slate-400">
                          {source.url}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                          <span>Last sync: {formatUiDate(source.last_synced_at, "Never")}</span>
                          <span>Cache: {formatUiDate(source.cached_fetched_at, "Empty")}</span>
                        </div>
                        {source.last_error ? (
                          <div className="mt-3 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                            {source.last_error}
                          </div>
                        ) : null}
                      </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="theme-accent-outline"
                            disabled={syncingSourceId === source.id}
                            onClick={() => handleEditSource(source)}
                          >
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="theme-accent-outline"
                            disabled={syncingSourceId === source.id}
                            onClick={() => void handleToggleSource(source)}
                          >
                            {source.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                          className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                          disabled={syncingSourceId === source.id}
                          onClick={() => void handleSyncSource(source.id)}
                        >
                          {syncingSourceId === source.id ? "Syncing..." : "Sync"}
                        </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="theme-accent-outline"
                            disabled={syncingSourceId === source.id}
                            onClick={() => void handleSyncSource(source.id, true)}
                          >
                          Force refresh
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
                          disabled={syncingSourceId === source.id}
                          onClick={() => void handleDeleteSource(source.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CardStat label="Nodes" value={String(proxies.length)} hint="In selected profile" />
          <CardStat label="Online" value={String(onlineCount)} hint="From latest full latency run" />
          <CardStat label="Untested" value={String(unknownCount)} hint="No confirmed result yet" />
          <CardStat
            label="Needs Edit"
            value={String(invalidCount)}
            hint="Missing or malformed settings detected"
            accentClassName="border-fuchsia-300/20 bg-fuchsia-400/10"
          />
        </div>
      </section>

      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingProxy ? "Edit Proxy" : "Add Manual Proxy"}</DialogTitle>
            <DialogDescription>
              Build or correct a node definition without leaving the editor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProxy}>
            <ProxyEditor value={proxyForm} onChange={setProxyForm} />
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingProxy ? "Save changes" : "Create proxy"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="rounded-[30px] border border-white/10 bg-[#0a101bd9] p-4 backdrop-blur md:p-6">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {viewModes.map((option) => {
              const Icon = option.icon
              const isActive = viewMode === option.value
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  className={`border-white/10 bg-white/5 text-white hover:bg-white/10 ${
                    isActive ? "theme-accent-active theme-accent-text" : ""
                  }`}
                  onClick={() => setViewMode(option.value)}
                >
                  <Icon className="size-4" />
                  {option.label}
                </Button>
              )
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_180px_180px_150px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filter by name, server, type, or SNI"
                className="border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProxyStatusFilter)}
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="all" className="bg-slate-900">All statuses</option>
              <option value="online" className="bg-slate-900">Online</option>
              <option value="offline" className="bg-slate-900">Offline</option>
              <option value="unknown" className="bg-slate-900">Unknown</option>
            </select>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as ProxySortKey)}
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="latency" className="bg-slate-900">Sort by latency</option>
              <option value="name" className="bg-slate-900">Sort by name</option>
              <option value="status" className="bg-slate-900">Sort by status</option>
            </select>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() =>
                setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
              }
            >
              <ArrowUpDown className="size-4" />
              {sortDirection === "asc" ? "Ascending" : "Descending"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400">Loading proxies...</div>
        ) : proxies.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ShieldAlert className="mx-auto mb-3 size-8 opacity-60" />
            No proxies configured for this profile yet.
          </div>
        ) : filteredProxies.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Search className="mx-auto mb-3 size-8 opacity-60" />
            No proxies match the current filter set.
          </div>
        ) : viewMode === "minimal" ? (
          <div className="space-y-3">
            {filteredProxies.map((proxy) => (
              <MinimalProxyRow
                key={proxy.id}
                proxy={proxy}
                onEdit={openEditDialog}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : viewMode === "table" ? (
          <ProxyTable
            proxies={filteredProxies}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onEdit={openEditDialog}
            onDelete={handleDelete}
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredProxies.map((proxy) => (
              <ExpandedProxyCard
                key={proxy.id}
                proxy={proxy}
                onEdit={openEditDialog}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function CardShell({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[#0e1828cc] p-5 text-white backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-2 text-sm text-slate-300">{description}</div>
        </div>
        {action}
      </div>
    </div>
  )
}

function CardStat({
  label,
  value,
  hint,
  accentClassName = "",
}: {
  label: string
  value: string
  hint: string
  accentClassName?: string
}) {
  return (
    <div
      className={`rounded-[28px] border border-white/10 bg-[#111827d6] p-5 text-white backdrop-blur ${accentClassName}`}
    >
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{hint}</div>
    </div>
  )
}

function ProxyMeta({ proxy }: { proxy: ProxyConfig }) {
  const issues = getProxyIssues(proxy)

  return (
    <div className="mt-1 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
      <span>{proxy.type}</span>
      {proxy.import_source_id ? (
        <span className="theme-accent-surface rounded-full border px-2 py-1 text-[10px] tracking-[0.2em] theme-accent-text">
          source-owned
        </span>
      ) : null}
      <span className={`size-2 rounded-full ${getStatusTone(proxy.status)}`} />
      <span>{formatLatency(proxy)}</span>
      {issues.length ? (
        <span className="rounded-full border border-fuchsia-300/30 bg-fuchsia-400/10 px-2 py-1 text-[10px] tracking-[0.24em] text-fuchsia-100">
          Needs edit
        </span>
      ) : null}
    </div>
  )
}

function ExpandedProxyCard({
  proxy,
  onEdit,
  onDelete,
}: {
  proxy: ProxyConfig
  onEdit: (proxy: ProxyConfig) => void
  onDelete: (proxyId: number) => void
}) {
  const issues = getProxyIssues(proxy)

  return (
    <div
      className={`rounded-[28px] border bg-white/5 p-5 text-white ${
        issues.length ? "border-fuchsia-300/30 shadow-[0_0_0_1px_rgba(232,121,249,0.08)]" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{proxy.name}</div>
          <ProxyMeta proxy={proxy} />
          {issues.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {issues.map((issue) => (
                <span
                  key={issue}
                  className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-fuchsia-100"
                >
                  {issue}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            onClick={() => onEdit(proxy)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            onClick={() => proxy.id && onDelete(proxy.id)}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
        <InfoField label="Server" value={proxy.server} mono />
        <InfoField label="Port" value={String(proxy.port)} mono />
        <InfoField label="UUID" value={proxy.uuid || "Not set"} mono />
        <InfoField label="SNI" value={proxy.sni || "Not set"} />
        <InfoField label="Public Key" value={proxy.public_key || "Not set"} mono />
        <InfoField label="Network" value={proxy.network || "Not set"} />
        {proxy.type === "ss" ? (
          <>
            <InfoField label="Cipher" value={proxy.cipher || "Not set"} mono />
            <InfoField label="Password" value={proxy.password || "Not set"} mono />
          </>
        ) : null}
        {proxy.type === "wireguard" ? (
          <>
            <InfoField label="DNS" value={proxy.dns_servers || "Not set"} mono />
            <InfoField label="MTU" value={String(proxy.mtu ?? 1280)} />
            <InfoField
              label="AmneziaWG"
              value={`jc=${proxy.awg_jc ?? defaultAwgOptions.awg_jc}, jmin=${proxy.awg_jmin ?? defaultAwgOptions.awg_jmin}, jmax=${proxy.awg_jmax ?? defaultAwgOptions.awg_jmax}, s1=${proxy.awg_s1 ?? defaultAwgOptions.awg_s1}, s2=${proxy.awg_s2 ?? defaultAwgOptions.awg_s2}, h1=${proxy.awg_h1 ?? defaultAwgOptions.awg_h1}, h2=${proxy.awg_h2 ?? defaultAwgOptions.awg_h2}, h3=${proxy.awg_h3 ?? defaultAwgOptions.awg_h3}, h4=${proxy.awg_h4 ?? defaultAwgOptions.awg_h4}`}
              mono
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

function MinimalProxyRow({
  proxy,
  onEdit,
  onDelete,
}: {
  proxy: ProxyConfig
  onEdit: (proxy: ProxyConfig) => void
  onDelete: (proxyId: number) => void
}) {
  const issues = getProxyIssues(proxy)

  return (
    <div
      className={`flex flex-col gap-4 rounded-[24px] border bg-white/5 p-4 text-white md:flex-row md:items-center md:justify-between ${
        issues.length ? "border-fuchsia-300/30" : "border-white/10"
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold">{proxy.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <span className="truncate">{proxy.server}:{proxy.port}</span>
          <span className="uppercase tracking-[0.2em] text-slate-500">{proxy.type}</span>
          {issues.length ? (
            <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-fuchsia-100">
              Needs edit
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:justify-end">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-[0.22em] text-slate-300">
          <span className={`size-2 rounded-full ${getStatusTone(proxy.status)}`} />
          {getStatusLabel(proxy.status)}
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-[0.22em] text-slate-300">
          {formatLatency(proxy)}
        </div>
        <Button
          size="icon"
          variant="outline"
          className="border-white/10 bg-white/5 text-white hover:bg-white/10"
          onClick={() => onEdit(proxy)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="border-white/10 bg-white/5 text-white hover:bg-white/10"
          onClick={() => proxy.id && onDelete(proxy.id)}
        >
          <Trash className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ProxyTable({
  proxies,
  sortKey,
  sortDirection,
  onSortChange,
  onEdit,
  onDelete,
}: {
  proxies: ProxyConfig[]
  sortKey: ProxySortKey
  sortDirection: SortDirection
  onSortChange: (nextSortKey: ProxySortKey) => void
  onEdit: (proxy: ProxyConfig) => void
  onDelete: (proxyId: number) => void
}) {
  const renderHeader = (label: string, key: ProxySortKey) => (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-left text-xs uppercase tracking-[0.24em] text-slate-400 transition hover:text-slate-200"
      onClick={() => onSortChange(key)}
    >
      {label}
      <ArrowUpDown className="size-3.5" />
      {sortKey === key ? (
        <span className="text-[10px] text-slate-500">{sortDirection}</span>
      ) : null}
    </button>
  )

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/10">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="bg-black/20">
            <tr>
              <th className="px-4 py-3">{renderHeader("Name", "name")}</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Server</th>
              <th className="px-4 py-3">{renderHeader("Latency", "latency")}</th>
              <th className="px-4 py-3">{renderHeader("Status", "status")}</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {proxies.map((proxy) => {
              const issues = getProxyIssues(proxy)

              return (
              <tr
                key={proxy.id}
                className={`border-t bg-white/3 ${issues.length ? "border-fuchsia-300/15" : "border-white/10"}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{proxy.name}</div>
                  <div className="text-xs text-slate-500">{proxy.port}</div>
                  {issues.length ? (
                    <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-fuchsia-200">
                      {issues.join(" • ")}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 uppercase tracking-[0.22em] text-slate-400">{proxy.type}</td>
                <td className="px-4 py-3 font-mono text-xs">{proxy.server}</td>
                <td className="px-4 py-3">{formatLatency(proxy)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                      issues.length
                        ? "border-fuchsia-300/25 text-fuchsia-100"
                        : "border-white/10 text-slate-300"
                    }`}
                  >
                    <span className={`size-2 rounded-full ${getStatusTone(proxy.status)}`} />
                    {issues.length ? "needs edit" : getStatusLabel(proxy.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => onEdit(proxy)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => proxy.id && onDelete(proxy.id)}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InfoField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={`mt-2 break-all text-sm text-slate-200 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  )
}

function AwgField({
  label,
  value,
  onChange,
}: {
  label: string
  value?: number | null
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        value={String(value ?? 0)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </div>
  )
}
