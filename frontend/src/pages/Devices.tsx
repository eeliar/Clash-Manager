import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import {
  ArrowRightLeft,
  Copy,
  KeyRound,
  Laptop,
  RefreshCw,
  RotateCcw,
  Smartphone,
  TabletSmartphone,
  Trash2,
  Unplug,
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
import { Input } from "@/components/ui/input"
import {
  createDevice,
  createDeviceToken,
  deleteDevice,
  deleteDeviceToken,
  getCurrentProfile,
  listDeviceTokens,
  listDevices,
  listProfiles,
  moveDevice,
  revokeDeviceToken,
  rotateDeviceToken,
} from "@/lib/api"
import { copyText } from "@/lib/copy"
import { formatUiDate } from "@/lib/dates"
import type { Device, Profile, SubscriptionToken } from "@/lib/api"

function getDeviceIcon(platform?: string | null) {
  const normalized = (platform || "").toLowerCase()
  if (normalized.includes("ios") || normalized.includes("android")) {
    return Smartphone
  }
  if (normalized.includes("ipad") || normalized.includes("tablet")) {
    return TabletSmartphone
  }
  return Laptop
}

function getTokenExpiryLabel(token: SubscriptionToken) {
  if (!token.expires_at) {
    return "Unlimited"
  }
  const expiresAt = new Date(token.expires_at)
  if (expiresAt.getTime() <= Date.now()) {
    return `Expired ${formatUiDate(token.expires_at, "Expired")}`
  }
  return `Expires ${formatUiDate(token.expires_at, "Not set")}`
}

function getTokenExpiryTone(token: SubscriptionToken) {
  if (!token.expires_at) {
    return "border-cyan-300/20 bg-cyan-300/8 text-cyan-100"
  }
  const expiresAt = new Date(token.expires_at)
  if (expiresAt.getTime() <= Date.now()) {
    return "border-rose-300/20 bg-rose-400/10 text-rose-100"
  }
  return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
}

export default function DevicesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [tokensByDevice, setTokensByDevice] = useState<Record<number, SubscriptionToken[]>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyTokenId, setBusyTokenId] = useState<number | null>(null)
  const [busyDeviceId, setBusyDeviceId] = useState<number | null>(null)
  const [moveTargets, setMoveTargets] = useState<Record<number, number>>({})
  const [tokenExpiryDrafts, setTokenExpiryDrafts] = useState<Record<number, string>>({})
  const [name, setName] = useState("")
  const [platform, setPlatform] = useState("")
  const [description, setDescription] = useState("")

  const loadDevices = async (profileId: number) => {
    const deviceList = await listDevices(profileId)
    setDevices(deviceList)
    setMoveTargets((current) => {
      const next = { ...current }
      for (const device of deviceList) {
        if (!(device.id in next)) {
          next[device.id] = device.profile_id
        }
      }
      return next
    })

    const tokenEntries = await Promise.all(
      deviceList.map(async (device) => [device.id, await listDeviceTokens(device.id)] as const),
    )
    setTokensByDevice(Object.fromEntries(tokenEntries))
  }

  const loadPage = async (profileId?: number | null) => {
    const [current, profileList] = await Promise.all([
      getCurrentProfile(),
      listProfiles(),
    ])
    setCurrentProfile(current)
    setProfiles(profileList)
    const nextProfileId = profileId ?? selectedProfileId ?? current.id
    setSelectedProfileId(nextProfileId)
    await loadDevices(nextProfileId)
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadPage()
      } catch {
        toast.error("Failed to load devices")
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
        await loadDevices(selectedProfileId)
      } catch {
        toast.error("Failed to refresh device list")
      }
    }
    run()
  }, [selectedProfileId])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadPage(selectedProfileId)
      toast.success("Device inventory refreshed")
    } catch {
      toast.error("Failed to refresh devices")
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateDevice = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId) {
      toast.error("No profile selected")
      return
    }
    if (!name.trim()) {
      toast.error("Device name is required")
      return
    }

    try {
      setCreating(true)
      await createDevice({
        profile_id: selectedProfileId,
        name: name.trim(),
        platform: platform.trim() || undefined,
        description: description.trim() || undefined,
      })
      setName("")
      setPlatform("")
      setDescription("")
      await loadDevices(selectedProfileId)
      toast.success("Device created")
    } catch {
      toast.error("Failed to create device")
    } finally {
      setCreating(false)
    }
  }

  const handleCreateToken = async (deviceId: number) => {
    try {
      setBusyDeviceId(deviceId)
      const expiryValue = tokenExpiryDrafts[deviceId]
      const created = await createDeviceToken(deviceId, {
        name: "primary",
        expires_at: expiryValue ? new Date(expiryValue).toISOString() : null,
      })
      setTokensByDevice((current) => ({
        ...current,
        [deviceId]: [...(current[deviceId] || []), created],
      }))
      setTokenExpiryDrafts((current) => ({ ...current, [deviceId]: "" }))
      toast.success("Subscription link created")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to create device token")
    } finally {
      setBusyDeviceId(null)
    }
  }

  const handleMoveDevice = async (device: Device) => {
    const targetProfileId = moveTargets[device.id]
    if (!targetProfileId || targetProfileId === device.profile_id) {
      toast.error("Choose a different profile first")
      return
    }

    try {
      setBusyDeviceId(device.id)
      await moveDevice(device.id, { profile_id: targetProfileId })
      setTokensByDevice((current) => {
        const tokens = current[device.id] || []
        return {
          ...current,
          [device.id]: tokens.map((token) => ({ ...token, profile_id: targetProfileId })),
        }
      })
      await loadPage(selectedProfileId)
      toast.success("Device moved to the selected profile")
    } catch {
      toast.error("Failed to move device")
    } finally {
      setBusyDeviceId(null)
    }
  }

  const handleDeleteDevice = async (device: Device) => {
    if (!selectedProfileId) {
      toast.error("No profile selected")
      return
    }
    if (
      !window.confirm(
        `Delete device "${device.name}" and revoke all of its subscription links?`,
      )
    ) {
      return
    }

    try {
      setBusyDeviceId(device.id)
      await deleteDevice(device.id)
      setTokensByDevice((current) => {
        const next = { ...current }
        delete next[device.id]
        return next
      })
      await loadDevices(selectedProfileId)
      toast.success("Device removed")
    } catch {
      toast.error("Failed to delete device")
    } finally {
      setBusyDeviceId(null)
    }
  }

  const handleRotateToken = async (deviceId: number, tokenId: number) => {
    try {
      setBusyTokenId(tokenId)
      const rotated = await rotateDeviceToken(tokenId)
      const nextTokens = (tokensByDevice[deviceId] || []).map((token) =>
        token.id === tokenId ? { ...token, is_active: false } : token,
      )
      setTokensByDevice((current) => ({
        ...current,
        [deviceId]: [rotated, ...nextTokens],
      }))
      toast.success("Subscription token rotated")
    } catch {
      toast.error("Failed to rotate token")
    } finally {
      setBusyTokenId(null)
    }
  }

  const handleRevokeToken = async (deviceId: number, tokenId: number) => {
    try {
      setBusyTokenId(tokenId)
      await revokeDeviceToken(tokenId)
      setTokensByDevice((current) => ({
        ...current,
        [deviceId]: (current[deviceId] || []).map((token) =>
          token.id === tokenId ? { ...token, is_active: false } : token,
        ),
      }))
      toast.success("Token revoked")
    } catch {
      toast.error("Failed to revoke token")
    } finally {
      setBusyTokenId(null)
    }
  }

  const handleDeleteToken = async (deviceId: number, tokenId: number) => {
    if (!window.confirm("Delete this revoked token permanently?")) {
      return
    }

    try {
      setBusyTokenId(tokenId)
      await deleteDeviceToken(tokenId)
      setTokensByDevice((current) => ({
        ...current,
        [deviceId]: (current[deviceId] || []).filter((token) => token.id !== tokenId),
      }))
      toast.success("Revoked token removed")
    } catch {
      toast.error("Failed to delete revoked token")
    } finally {
      setBusyTokenId(null)
    }
  }

  const handleCopy = async (value: string) => {
    try {
      await copyText(value)
      toast.success("Subscription URL copied")
    } catch {
      toast.error("Failed to copy subscription URL")
    }
  }

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? currentProfile
  const activeTokenCount = Object.values(tokensByDevice).flat().filter((token) => token.is_active)
    .length

  return (
    <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden border-white/10 bg-[#07111fcc] text-white backdrop-blur">
          <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <Badge className="theme-accent-badge w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
                Device Links
              </Badge>
              <div>
                <CardTitle className="text-3xl">Subscription Delivery</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-sm text-slate-300">
                  Generate per-device subscription links, rotate compromised tokens,
                  and keep rollout ownership visible from one screen.
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
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Selected Profile
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {selectedProfile?.name ?? "Loading"}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {selectedProfile?.slug || "Waiting for backend"}
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/8 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/70">
                Managed Devices
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">{devices.length}</div>
              <div className="mt-2 text-sm text-emerald-50/70">
                Device-scoped subscriptions
              </div>
            </div>
            <div className="theme-accent-surface rounded-3xl border p-4">
              <div className="theme-accent-text text-xs uppercase tracking-[0.24em]">
                Active Tokens
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">{activeTokenCount}</div>
              <div className="theme-accent-text mt-2 text-sm">
                Public links currently usable
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#121526d8] text-white backdrop-blur">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="theme-accent-frame rounded-2xl border p-3">
                <KeyRound className="size-5" />
              </div>
              <div>
                <CardTitle>Add Device</CardTitle>
                <CardDescription className="mt-1 text-slate-300">
                  Register a client first, then issue links per device.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateDevice}>
              <div className="grid gap-3 sm:grid-cols-2">
                {profiles.length > 0 && (
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
                )}
                <Input
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                  placeholder="ios, android, windows..."
                  className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
                />
              </div>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Device name"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Owner or rollout notes"
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
              />
              <Button
                type="submit"
                className="theme-accent-button w-full rounded-xl"
                disabled={creating}
              >
                {creating ? "Adding..." : "Register device"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="border-white/10 bg-[#09111dcc] text-white backdrop-blur">
          <CardHeader>
            <CardTitle>Device Inventory</CardTitle>
            <CardDescription className="text-slate-300">
              Token operations happen per device so rotations do not affect unrelated clients.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-2">
            {loading ? (
              <div className="col-span-full rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-400">
                Loading devices...
              </div>
            ) : devices.length === 0 ? (
              <div className="col-span-full rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-400">
                No devices registered for this profile yet.
              </div>
            ) : (
              devices.map((device) => {
                const DeviceIcon = getDeviceIcon(device.platform)
                const tokens = tokensByDevice[device.id] || []

                return (
                  <div
                    key={device.id}
                    className="rounded-[28px] border border-white/10 bg-white/5 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="rounded-2xl bg-white/10 p-3 text-white">
                          <DeviceIcon className="size-5" />
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-white">{device.name}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                            {device.platform || "unknown platform"}
                          </div>
                          <div className="mt-3 text-sm text-slate-300">
                            {device.description || "No notes for this device."}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="rounded-full bg-white text-slate-950 hover:bg-slate-100"
                          disabled={busyDeviceId === device.id}
                          onClick={() => void handleCreateToken(device.id)}
                        >
                          {busyDeviceId === device.id ? "Working..." : "New token"}
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
                          disabled={busyDeviceId === device.id}
                          onClick={() => void handleDeleteDevice(device)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 text-xs text-slate-400 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
                        <div className="uppercase tracking-[0.16em] text-slate-500">
                          Created
                        </div>
                        <div className="mt-2 text-sm text-slate-200">
                          {formatUiDate(device.created_at, "Never")}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
                        <div className="uppercase tracking-[0.16em] text-slate-500">
                          Last Seen
                        </div>
                        <div className="mt-2 text-sm text-slate-200">
                          {formatUiDate(device.last_seen_at, "Never")}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        New Token Expiry
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                        <Input
                          type="datetime-local"
                          value={tokenExpiryDrafts[device.id] || ""}
                          onChange={(event) =>
                            setTokenExpiryDrafts((current) => ({
                              ...current,
                              [device.id]: event.target.value,
                            }))
                          }
                          className="border-white/10 bg-white/5 text-white"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                          onClick={() =>
                            setTokenExpiryDrafts((current) => ({ ...current, [device.id]: "" }))
                          }
                        >
                          Unlimited
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        Leave empty for an unlimited token. Expiry is preserved on rotation.
                      </div>
                    </div>

                    <div className="theme-accent-surface rounded-2xl border p-4">
                      <div className="theme-accent-text flex items-center gap-2 text-xs uppercase tracking-[0.18em]">
                        <ArrowRightLeft className="size-4" />
                        Reassign Device
                      </div>
                      <div className="mt-3 flex flex-col gap-3 md:flex-row">
                        <select
                          value={moveTargets[device.id] ?? device.profile_id}
                          onChange={(event) =>
                            setMoveTargets((current) => ({
                              ...current,
                              [device.id]: Number(event.target.value),
                            }))
                          }
                          className="h-10 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
                        >
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id} className="bg-slate-900">
                              {profile.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="outline"
                          className="theme-accent-outline"
                          disabled={
                            busyDeviceId === device.id ||
                            (moveTargets[device.id] ?? device.profile_id) === device.profile_id
                          }
                          onClick={() => void handleMoveDevice(device)}
                        >
                          {busyDeviceId === device.id ? "Moving..." : "Move"}
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-slate-300">
                        Existing subscription links stay the same and start serving the new profile.
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {tokens.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                          No subscription token issued yet.
                        </div>
                      ) : (
                        tokens.map((token) => (
                          <div
                            key={token.id}
                            className="rounded-2xl border border-white/10 bg-[#050914] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    className={`rounded-full ${
                                      token.is_active
                                        ? "bg-emerald-400/15 text-emerald-100"
                                        : "bg-white/10 text-slate-300"
                                    }`}
                                  >
                                    {token.is_active ? "Active" : "Revoked"}
                                  </Badge>
                                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                    {token.name}
                                  </span>
                                </div>
                                <div className="theme-accent-code break-all font-mono text-xs">
                                  {token.subscription_url}
                                </div>
                              </div>
                              <div
                                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${getTokenExpiryTone(token)}`}
                              >
                                {getTokenExpiryLabel(token)}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                                  onClick={() => void handleCopy(token.subscription_url)}
                                >
                                  <Copy className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                                  onClick={() => void handleRotateToken(device.id, token.id)}
                                  disabled={!token.is_active || busyTokenId === token.id}
                                >
                                  <RotateCcw className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                                  onClick={() => void handleRevokeToken(device.id, token.id)}
                                  disabled={!token.is_active || busyTokenId === token.id}
                                >
                                  <Unplug className="size-4" />
                                </Button>
                                {!token.is_active && (
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
                                    onClick={() => void handleDeleteToken(device.id, token.id)}
                                    disabled={busyTokenId === token.id}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                              <div>Issued {formatUiDate(token.created_at, "Never")}</div>
                              <div>Last used {formatUiDate(token.last_used_at, "Never")}</div>
                              <div>{getTokenExpiryLabel(token)}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
