import axios from "axios"

export interface Profile {
  id: number
  name: string
  slug: string
  description?: string | null
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  proxy_count?: number
  group_count?: number
  rule_count?: number
  revision_count?: number
  device_count?: number
  token_count?: number
  external_controller?: string | null
  external_ui?: string | null
  secret?: string | null
  mixed_port?: number | null
  allow_lan?: boolean | null
}

export interface Revision {
  id: number
  profile_id: number
  version: number
  status: "draft" | "published" | "archived"
  source: string
  change_summary?: string | null
  generated_yaml?: string | null
  created_at: string
  published_at?: string | null
}

export interface Device {
  id: number
  profile_id: number
  name: string
  platform?: string | null
  description?: string | null
  is_active: boolean
  created_at: string
  last_seen_at?: string | null
}

export interface SubscriptionToken {
  id: number
  profile_id: number
  device_id?: number | null
  name: string
  token: string
  is_active: boolean
  created_at: string
  expires_at?: string | null
  last_used_at?: string | null
  subscription_url: string
}

export interface SubscriptionSource {
  id: number
  profile_id: number
  name: string
  url: string
  is_active: boolean
  created_at: string
  last_synced_at?: string | null
  last_error?: string | null
  cached_fetched_at?: string | null
}

export interface SourceSyncResult {
  source: SubscriptionSource
  used_cache: boolean
  created: number
  updated: number
  removed: number
  warnings: string[]
  errors: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  profile_id: number
}

export interface ProfileCreateInput {
  name: string
  description?: string
  clone_from_profile_id?: number | null
  activate_after_create?: boolean
}

export interface RevisionActionInput {
  change_summary?: string
  source?: string
}

export interface DeviceCreateInput {
  profile_id?: number | null
  name: string
  platform?: string
  description?: string
}

export interface DeviceMoveInput {
  profile_id: number
}

export interface TokenCreateInput {
  name?: string
  expires_at?: string | null
}

export interface ProxyConfig {
  id?: number
  profile_id?: number | null
  name: string
  type: string
  server: string
  port: number
  uuid?: string | null
  network?: string | null
  tls?: boolean
  udp?: boolean
  flow?: string | null
  sni?: string | null
  public_key?: string | null
  short_id?: string | null
  fingerprint?: string | null
  cipher?: string | null
  password?: string | null
  private_key?: string | null
  ip_address?: string | null
  dns_servers?: string | null
  mtu?: number | null
  awg_jc?: number | null
  awg_jmin?: number | null
  awg_jmax?: number | null
  awg_s1?: number | null
  awg_s2?: number | null
  awg_h1?: number | null
  awg_h2?: number | null
  awg_h3?: number | null
  awg_h4?: number | null
  status?: string
  latency?: number | null
  tags?: string | null
  import_source_id?: number | null
  import_source_key?: string | null
}

export interface ProxyLatencyTestSummary {
  profile_id?: number | null
  tested: number
  online: number
  offline: number
  method?: string | null
  delay_url?: string | null
}

export interface GroupMember {
  id: number | string
  name: string
  type: string
  status?: string
  is_target?: boolean
  target_kind?: "group" | "builtin"
}

export interface ProxyGroup {
  id: number
  profile_id?: number | null
  name: string
  type: string
  order?: number
  test_url: string
  interval: number
  tolerance: number
  members: GroupMember[]
}

export interface RuleEntry {
  id: number
  profile_id?: number | null
  type: string
  payload: string
  target: string
  order: number
  comment?: string | null
}

export interface ProfileCopyItemsInput {
  source_profile_id: number
  proxy_ids: number[]
  group_ids: number[]
  rule_ids: number[]
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  headers: {
    "Content-Type": "application/json",
  },
})

function isUnexpectedHtmlResponse(contentType?: string, data?: unknown) {
  return (
    typeof data === "string" &&
    typeof contentType === "string" &&
    contentType.includes("text/html")
  )
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("clash_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    if (
      isUnexpectedHtmlResponse(
        response.headers["content-type"],
        response.data,
      )
    ) {
      return Promise.reject(
        new Error("Unexpected HTML response from API. Check frontend proxy routes."),
      )
    }
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("clash_token")
      window.location.href = "/login"
    }
    return Promise.reject(error)
  },
)

export async function listProfiles() {
  const response = await api.get<Profile[]>("/profiles")
  return response.data
}

export async function getCurrentProfile() {
  const response = await api.get<Profile>("/profiles/current")
  return response.data
}

export async function createProfile(payload: ProfileCreateInput) {
  const response = await api.post<Profile>("/profiles", payload)
  return response.data
}

export async function activateProfile(profileId: number) {
  const response = await api.post<Profile>(`/profiles/${profileId}/activate`)
  return response.data
}

export async function updateProfile(profileId: number, payload: Partial<Profile>) {
  const response = await api.put<Profile>(`/profiles/${profileId}`, payload)
  return response.data
}

export async function deleteProfile(profileId: number) {
  await api.delete(`/profiles/${profileId}`)
}

export async function copyProfileItems(
  profileId: number,
  payload: ProfileCopyItemsInput,
) {
  const response = await api.post(`/profiles/${profileId}/copy-items`, payload)
  return response.data
}

export async function listProfileRevisions(profileId: number) {
  const response = await api.get<Revision[]>(`/revisions/profiles/${profileId}`)
  return response.data
}

export async function validateProfile(profileId: number) {
  const response = await api.get<ValidationResult>(
    `/revisions/profiles/${profileId}/validate`,
  )
  return response.data
}

export async function publishProfile(profileId: number, payload: RevisionActionInput) {
  const response = await api.post<Revision>(
    `/revisions/profiles/${profileId}/publish`,
    payload,
  )
  return response.data
}

export async function snapshotDraft(profileId: number, payload: RevisionActionInput) {
  const response = await api.post<Revision>(
    `/revisions/profiles/${profileId}/draft`,
    payload,
  )
  return response.data
}

export async function rollbackRevision(revisionId: number) {
  const response = await api.post<Revision>(`/revisions/${revisionId}/rollback`)
  return response.data
}

export async function listDevices(profileId?: number) {
  const response = await api.get<Device[]>("/devices", {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function createDevice(payload: DeviceCreateInput) {
  const response = await api.post<Device>("/devices", payload)
  return response.data
}

export async function moveDevice(deviceId: number, payload: DeviceMoveInput) {
  const response = await api.post<Device>(`/devices/${deviceId}/move`, payload)
  return response.data
}

export async function deleteDevice(deviceId: number) {
  await api.delete(`/devices/${deviceId}`)
}

export async function listDeviceTokens(deviceId: number) {
  const response = await api.get<SubscriptionToken[]>(`/devices/${deviceId}/tokens`)
  return response.data
}

export async function createDeviceToken(deviceId: number, payload: TokenCreateInput) {
  const response = await api.post<SubscriptionToken>(
    `/devices/${deviceId}/tokens`,
    payload,
  )
  return response.data
}

export async function rotateDeviceToken(tokenId: number) {
  const response = await api.post<SubscriptionToken>(
    `/devices/tokens/${tokenId}/rotate`,
  )
  return response.data
}

export async function revokeDeviceToken(tokenId: number) {
  await api.post(`/devices/tokens/${tokenId}/revoke`)
}

export async function deleteDeviceToken(tokenId: number) {
  await api.delete(`/devices/tokens/${tokenId}`)
}

export async function listSources(profileId?: number) {
  const response = await api.get<SubscriptionSource[]>("/sources", {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function createSource(payload: {
  profile_id?: number | null
  name: string
  url: string
  is_active?: boolean
}) {
  const response = await api.post<SourceSyncResult>("/sources", payload)
  return response.data
}

export async function syncSource(sourceId: number, force = false) {
  const response = await api.post<SourceSyncResult>(`/sources/${sourceId}/sync`, null, {
    params: force ? { force: true } : undefined,
  })
  return response.data
}

export async function updateSource(
  sourceId: number,
  payload: { name: string; url: string; is_active?: boolean },
) {
  const response = await api.put<SubscriptionSource>(`/sources/${sourceId}`, payload)
  return response.data
}

export async function deleteSource(sourceId: number) {
  await api.delete(`/sources/${sourceId}`)
}

export async function listProxies(profileId?: number) {
  const response = await api.get<ProxyConfig[]>("/proxies", {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function createProxy(payload: ProxyConfig) {
  const response = await api.post<ProxyConfig>("/proxies", payload)
  return response.data
}

export async function updateProxy(proxyId: number, payload: ProxyConfig) {
  const response = await api.put<ProxyConfig>(`/proxies/${proxyId}`, payload)
  return response.data
}

export async function deleteProxy(proxyId: number) {
  await api.delete(`/proxies/${proxyId}`)
}

export async function importVless(link: string, profileId?: number) {
  const formData = new URLSearchParams()
  formData.append("link", link)
  if (profileId) {
    formData.append("profile_id", String(profileId))
  }
  const response = await api.post<ProxyConfig>("/proxies/parse/vless", formData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })
  return response.data
}

export async function importSs(link: string, profileId?: number) {
  const formData = new URLSearchParams()
  formData.append("link", link)
  if (profileId) {
    formData.append("profile_id", String(profileId))
  }
  const response = await api.post<ProxyConfig>("/proxies/parse/ss", formData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })
  return response.data
}

export async function importWireguard(file: File, profileId?: number) {
  const formData = new FormData()
  formData.append("file", file)
  if (profileId) {
    formData.append("profile_id", String(profileId))
  }
  const response = await api.post<ProxyConfig>("/proxies/parse/wireguard", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  })
  return response.data
}

export async function triggerProxyLatencyTest(profileId?: number) {
  const response = await api.post<ProxyLatencyTestSummary>("/proxies/test", null, {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function listGroups(profileId?: number) {
  const response = await api.get<ProxyGroup[]>("/groups", {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function createGroup(payload: Partial<ProxyGroup>) {
  const response = await api.post<ProxyGroup>("/groups", payload)
  return response.data
}

export async function updateGroup(groupId: number, payload: Partial<ProxyGroup>) {
  const response = await api.put<ProxyGroup>(`/groups/${groupId}`, payload)
  return response.data
}

export async function deleteGroup(groupId: number) {
  await api.delete(`/groups/${groupId}`)
}

export async function attachProxyToGroup(groupId: number, proxyId: number) {
  await api.post(`/groups/${groupId}/members/${proxyId}`)
}

export async function detachProxyFromGroup(groupId: number, proxyId: number) {
  await api.delete(`/groups/${groupId}/members/${proxyId}`)
}

export async function attachTargetToGroup(groupId: number, targetName: string) {
  await api.post(`/groups/${groupId}/target/${encodeURIComponent(targetName)}`)
}

export async function detachTargetFromGroup(groupId: number, targetName: string) {
  await api.delete(`/groups/${groupId}/target/${encodeURIComponent(targetName)}`)
}

export async function reorderGroupMembers(
  groupId: number,
  members: Array<{ proxy_id?: number; target_name?: string }>,
) {
  await api.post(`/groups/${groupId}/members/reorder`, { members })
}

export async function reorderGroups(groupIds: number[], profileId?: number) {
  await api.post(
    "/groups/reorder",
    { group_ids: groupIds },
    { params: profileId ? { profile_id: profileId } : undefined },
  )
}

export async function listRules(profileId?: number) {
  const response = await api.get<RuleEntry[]>("/rules", {
    params: profileId ? { profile_id: profileId } : undefined,
  })
  return response.data
}

export async function createRule(payload: Partial<RuleEntry>) {
  const response = await api.post<RuleEntry>("/rules", payload)
  return response.data
}

export async function updateRule(ruleId: number, payload: Partial<RuleEntry>) {
  const response = await api.put<RuleEntry>(`/rules/${ruleId}`, payload)
  return response.data
}

export async function deleteRule(ruleId: number) {
  await api.delete(`/rules/${ruleId}`)
}

export async function reorderRules(ruleIds: number[]) {
  await api.post("/rules/reorder", { rule_ids: ruleIds })
}

export default api
