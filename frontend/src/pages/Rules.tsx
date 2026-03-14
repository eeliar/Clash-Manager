import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import {
  createRule,
  deleteRule,
  getCurrentProfile,
  listGroups,
  listProfiles,
  listRules,
  reorderRules,
  updateRule,
} from "@/lib/api"
import type { Profile, ProxyGroup, RuleEntry } from "@/lib/api"

const ruleTypes = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "GEOIP", "MATCH"]

const emptyRule = (profileId?: number | null): Partial<RuleEntry> => ({
  profile_id: profileId ?? undefined,
  type: "DOMAIN-SUFFIX",
  payload: "",
  target: "DIRECT",
  order: 0,
  comment: "",
})

type GroupedRuleBlock = {
  key: string
  type: string
  target: string
  rules: RuleEntry[]
}

export default function Rules() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [rules, setRules] = useState<RuleEntry[]>([])
  const [groups, setGroups] = useState<ProxyGroup[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RuleEntry | null>(null)
  const [ruleForm, setRuleForm] = useState<Partial<RuleEntry>>(emptyRule())
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupedRuleBlock | null>(null)
  const [batchForm, setBatchForm] = useState({
    type: "DOMAIN-SUFFIX",
    target: "DIRECT",
    payload: "",
    comment: "",
  })

  const loadPage = async (profileId?: number | null) => {
    const [currentProfile, profileList] = await Promise.all([
      getCurrentProfile(),
      listProfiles(),
    ])
    const nextProfileId = profileId ?? selectedProfileId ?? currentProfile.id
    const [ruleList, groupList] = await Promise.all([
      listRules(nextProfileId),
      listGroups(nextProfileId),
    ])
    setProfiles(profileList)
    setSelectedProfileId(nextProfileId)
    setRules(ruleList)
    setGroups(groupList)
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadPage()
      } catch {
        toast.error("Failed to load rules")
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
        const [ruleList, groupList] = await Promise.all([
          listRules(selectedProfileId),
          listGroups(selectedProfileId),
        ])
        setRules(ruleList)
        setGroups(groupList)
      } catch {
        toast.error("Failed to refresh rules")
      }
    }
    run()
  }, [selectedProfileId])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadPage(selectedProfileId)
      toast.success("Rules refreshed")
    } catch {
      toast.error("Failed to refresh rules")
    } finally {
      setRefreshing(false)
    }
  }

  const openCreateDialog = () => {
    setEditingRule(null)
    setRuleForm(emptyRule(selectedProfileId))
    setModalOpen(true)
  }

  const openEditDialog = (rule: RuleEntry) => {
    setEditingRule(rule)
    setRuleForm({ ...rule })
    setModalOpen(true)
  }

  const openBatchDialog = (group: GroupedRuleBlock) => {
    const comments = Array.from(
      new Set(group.rules.map((rule) => (rule.comment || "").trim()).filter(Boolean)),
    )
    setEditingGroup(group)
    setBatchForm({
      type: group.type,
      target: group.target,
      payload: group.rules.map((rule) => rule.payload).join("\n"),
      comment: comments.length === 1 ? comments[0] : "",
    })
    setBatchModalOpen(true)
  }

  const handleSaveRule = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId || !ruleForm.type || !ruleForm.target) {
      return
    }
    const payloadLines =
      ruleForm.type === "MATCH"
        ? ["ALL"]
        : (ruleForm.payload || "")
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean)

    if (payloadLines.length === 0) {
      toast.error("Payload is required for this rule type")
      return
    }
    if (editingRule && payloadLines.length > 1) {
      toast.error("Bulk payload entry is only available when creating new rules")
      return
    }

    const payload = {
      profile_id: selectedProfileId,
      type: ruleForm.type,
      payload: payloadLines[0],
      target: ruleForm.target,
      order: editingRule?.order ?? rules.length,
      comment: ruleForm.comment?.trim() || null,
    }

    try {
      setSaving(true)
      if (editingRule?.id) {
        await updateRule(editingRule.id, payload)
        toast.success("Rule updated")
      } else {
        for (const [index, line] of payloadLines.entries()) {
          await createRule({
            ...payload,
            payload: line,
            order: rules.length + index,
          })
        }
        toast.success(
          payloadLines.length === 1
            ? "Rule created"
            : `${payloadLines.length} rules created`,
        )
      }
      setModalOpen(false)
      await loadPage(selectedProfileId)
    } catch {
      toast.error("Failed to save rule")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRule = async (ruleId: number) => {
    if (!window.confirm("Delete this rule?")) {
      return
    }
    try {
      await deleteRule(ruleId)
      toast.success("Rule deleted")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    } catch {
      toast.error("Failed to delete rule")
    }
  }

  const moveRule = async (ruleId: number, direction: -1 | 1) => {
    const index = rules.findIndex((rule) => rule.id === ruleId)
    const nextIndex = index + direction
    if (index === -1 || nextIndex < 0 || nextIndex >= rules.length) {
      return
    }

    const nextRules = [...rules]
    const [item] = nextRules.splice(index, 1)
    nextRules.splice(nextIndex, 0, item)
    setRules(nextRules.map((rule, order) => ({ ...rule, order })))

    try {
      await reorderRules(nextRules.map((rule) => rule.id))
    } catch {
      toast.error("Failed to reorder rules")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    }
  }

  const handleSaveBatch = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId || !editingGroup || !batchForm.type || !batchForm.target) {
      return
    }

    const payloadLines =
      batchForm.type === "MATCH"
        ? ["ALL"]
        : batchForm.payload
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean)

    if (payloadLines.length === 0) {
      toast.error("At least one payload is required")
      return
    }

    const orderedRules = [...rules].sort((left, right) => left.order - right.order)
    const groupRuleIds = new Set(editingGroup.rules.map((rule) => rule.id))
    const existingGroupRules = orderedRules.filter((rule) => groupRuleIds.has(rule.id))
    const remainingRuleIds = orderedRules
      .filter((rule) => !groupRuleIds.has(rule.id))
      .map((rule) => rule.id)
    const insertAt = orderedRules.findIndex((rule) => groupRuleIds.has(rule.id))
    const normalizedComment = batchForm.comment.trim() || null
    const retainedIds: number[] = []

    try {
      setSaving(true)

      for (const [index, line] of payloadLines.entries()) {
        const existingRule = existingGroupRules[index]
        if (existingRule) {
          await updateRule(existingRule.id, {
            profile_id: selectedProfileId,
            type: batchForm.type,
            payload: line,
            target: batchForm.target,
            order: existingRule.order,
            comment: normalizedComment,
          })
          retainedIds.push(existingRule.id)
        } else {
          const created = await createRule({
            profile_id: selectedProfileId,
            type: batchForm.type,
            payload: line,
            target: batchForm.target,
            order: rules.length + index,
            comment: normalizedComment,
          })
          retainedIds.push(created.id)
        }
      }

      for (const staleRule of existingGroupRules.slice(payloadLines.length)) {
        await deleteRule(staleRule.id)
      }

      const nextRuleIds = [...remainingRuleIds]
      const insertionPoint = insertAt === -1 ? nextRuleIds.length : insertAt
      nextRuleIds.splice(insertionPoint, 0, ...retainedIds)
      await reorderRules(nextRuleIds)

      setBatchModalOpen(false)
      setEditingGroup(null)
      await loadPage(selectedProfileId)
      toast.success(
        payloadLines.length === 1
          ? "Rule block updated"
          : `${payloadLines.length} combined rules saved`,
      )
    } catch {
      toast.error("Failed to save combined rules")
    } finally {
      setSaving(false)
    }
  }

  const filteredRules = rules.filter((rule) =>
    `${rule.type} ${rule.payload} ${rule.target} ${rule.comment || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  const groupedRules: GroupedRuleBlock[] = Array.from(
    filteredRules.reduce(
      (groupsMap, rule) => {
        const key = `${rule.type}::${rule.target}`
        const group = groupsMap.get(key) || { key, type: rule.type, target: rule.target, rules: [] as RuleEntry[] }
        group.rules.push(rule)
        groupsMap.set(key, group)
        return groupsMap
      },
      new Map<string, { key: string; type: string; target: string; rules: RuleEntry[] }>(),
    ).values(),
  )

  return (
    <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="rounded-[32px] border border-white/10 bg-[#101322d8] p-8 text-white backdrop-blur">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Badge className="theme-accent-badge rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
              Rule Sequencer
            </Badge>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">Routing Builder</h1>
              <p className="mt-2 max-w-2xl text-slate-300">
                Edit rule logic directly, move priorities without re-creating entries, and keep targeting aligned with live groups.
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
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter rules"
              className="w-56 border-white/10 bg-white/5 text-white placeholder:text-slate-400"
            />
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
              <DialogTrigger asChild>
                <Button className="theme-accent-button" onClick={openCreateDialog}>
                  <Plus />
                  Add rule
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingRule ? "Edit Rule" : "Create Rule"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSaveRule} className="space-y-4 py-4">
                  <div className="space-y-2">
                    <LabelRow label="Rule Type" />
                    <select
                      value={ruleForm.type}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          type: event.target.value,
                          payload: event.target.value === "MATCH" ? "ALL" : current.payload,
                        }))
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {ruleTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <LabelRow label="Payload" />
                    <textarea
                      value={ruleForm.type === "MATCH" ? "ALL" : ruleForm.payload || ""}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, payload: event.target.value }))
                      }
                      disabled={ruleForm.type === "MATCH"}
                      rows={editingRule ? 3 : 5}
                      placeholder="example.com or 1.1.1.1/32"
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
                    />
                    {!editingRule ? (
                      <div className="text-xs text-slate-400">
                        Add one payload per line to create several rules with the same type, target, and comment.
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <LabelRow label="Target" />
                    <select
                      value={ruleForm.target}
                      onChange={(event) => setRuleForm((current) => ({ ...current, target: event.target.value }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="DIRECT">DIRECT</option>
                      <option value="PROXY">PROXY</option>
                      <option value="REJECT">REJECT</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.name}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <LabelRow label="Comment" />
                    <Input
                      value={ruleForm.comment || ""}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, comment: event.target.value }))
                      }
                      placeholder="Optional note shown above this rule in generated YAML"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : editingRule ? "Save changes" : "Create rule"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Combine Similar Rules</DialogTitle>
                  <DialogDescription>
                    Edit this grouped rule block as one shared type, target, comment, and payload list.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSaveBatch} className="space-y-4 py-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <LabelRow label="Rule Type" />
                      <select
                        value={batchForm.type}
                        onChange={(event) =>
                          setBatchForm((current) => ({
                            ...current,
                            type: event.target.value,
                            payload: event.target.value === "MATCH" ? "ALL" : current.payload,
                          }))
                        }
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {ruleTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <LabelRow label="Target" />
                      <select
                        value={batchForm.target}
                        onChange={(event) =>
                          setBatchForm((current) => ({ ...current, target: event.target.value }))
                        }
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="DIRECT">DIRECT</option>
                        <option value="PROXY">PROXY</option>
                        <option value="REJECT">REJECT</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.name}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <LabelRow label="Comment" />
                    <Input
                      value={batchForm.comment}
                      onChange={(event) =>
                        setBatchForm((current) => ({ ...current, comment: event.target.value }))
                      }
                      placeholder="Applied to all combined rules"
                    />
                  </div>
                  <div className="space-y-2">
                    <LabelRow label="Payloads" />
                    <textarea
                      value={batchForm.type === "MATCH" ? "ALL" : batchForm.payload}
                      onChange={(event) =>
                        setBatchForm((current) => ({ ...current, payload: event.target.value }))
                      }
                      disabled={batchForm.type === "MATCH"}
                      rows={8}
                      className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
                    />
                    <div className="text-xs text-slate-400">
                      One payload per line. Saving normalizes this group into one contiguous block.
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save combined rules"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-[#0b101ad6] p-4 backdrop-blur md:p-6">
        {loading ? (
          <div className="py-16 text-center text-slate-400">Loading rules...</div>
        ) : filteredRules.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No rules matched this profile and filter.</div>
        ) : (
          <div className="space-y-3">
            {groupedRules.map((group) => (
              <div
                key={group.key}
                className="rounded-[28px] border border-white/10 bg-white/5 p-5 text-white"
              >
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Badge className="theme-accent-badge rounded-full">
                    {group.type}
                  </Badge>
                  <Badge className="rounded-full bg-white/10 text-white">
                    {group.target}
                  </Badge>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {group.rules.length} entries
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="theme-accent-outline ml-auto"
                    onClick={() => openBatchDialog(group)}
                  >
                    Combine
                  </Button>
                </div>
                <div className="space-y-3">
                  {group.rules.map((rule) => {
                    const orderIndex = rules.findIndex((entry) => entry.id === rule.id)
                    return (
                      <div
                        key={rule.id}
                        className="rounded-2xl border border-white/10 bg-black/15 p-4"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <Badge className="rounded-full bg-white/10 text-white">
                                #{orderIndex + 1}
                              </Badge>
                              {rule.comment ? (
                                <span className="theme-accent-surface theme-accent-text rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em]">
                                  {rule.comment}
                                </span>
                              ) : null}
                            </div>
                            <div className="font-mono text-sm text-slate-200">{rule.payload}</div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              disabled={orderIndex === 0}
                              onClick={() => void moveRule(rule.id, -1)}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              disabled={orderIndex === rules.length - 1}
                              onClick={() => void moveRule(rule.id, 1)}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => openEditDialog(rule)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => void handleDeleteRule(rule.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function LabelRow({ label }: { label: string }) {
  return <div className="text-sm font-medium text-foreground">{label}</div>
}
