import { useEffect, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { DndProvider, useDrag, useDrop } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  attachProxyToGroup,
  attachTargetToGroup,
  createGroup,
  deleteGroup,
  detachProxyFromGroup,
  detachTargetFromGroup,
  getCurrentProfile,
  listGroups,
  listProfiles,
  listProxies,
  reorderGroups,
  reorderGroupMembers,
  updateGroup,
} from "@/lib/api"
import type { Profile, ProxyConfig, ProxyGroup } from "@/lib/api"

type DragItem = {
  kind: "proxy" | "target"
  id: number | string
  name: string
  targetKind?: "group" | "builtin" | "tag"
}

type GroupForm = {
  id?: number
  name: string
  type: string
  test_url: string
  interval: number
  tolerance: number
}

const emptyGroup = (): GroupForm => ({
  name: "",
  type: "select",
  test_url: "http://www.gstatic.com/generate_204",
  interval: 300,
  tolerance: 50,
})

function InventorySection({
  title,
  count,
  collapsed,
  onToggle,
  children,
  emptyState,
}: {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
  emptyState?: ReactNode
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/10">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{title}</div>
          <div className="mt-1 text-sm text-slate-500">
            {collapsed ? `${count} hidden` : `${count} available`}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">
            {count}
          </Badge>
          <div className="rounded-2xl bg-white/5 p-2 text-slate-300">
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </div>
      </button>
      {!collapsed && (
        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          {count > 0 ? children : emptyState}
        </div>
      )}
    </div>
  )
}

function DraggableProxy({ proxy }: { proxy: ProxyConfig }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "PROXY_MEMBER",
    item: { kind: "proxy", id: proxy.id!, name: proxy.name } satisfies DragItem,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }))

  return (
    <div
      ref={(node) => {
        drag(node)
      }}
      className={`rounded-2xl border border-white/10 bg-white/5 p-3 text-white ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="font-medium">{proxy.name}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
        {proxy.type}
      </div>
    </div>
  )
}

function describeTarget(kind?: "group" | "builtin" | "tag") {
  if (kind === "builtin") {
    return "builtin target"
  }
  if (kind === "tag") {
    return "dynamic tag"
  }
  return "selector group"
}

function GroupCard({
  group,
  index,
  total,
  onDropItem,
  onDelete,
  onEdit,
  onMoveGroup,
  onMoveMember,
  onRemoveMember,
}: {
  group: ProxyGroup
  index: number
  total: number
  onDropItem: (group: ProxyGroup, item: DragItem) => void
  onDelete: (groupId: number) => void
  onEdit: (group: ProxyGroup) => void
  onMoveGroup: (group: ProxyGroup, direction: -1 | 1) => void
  onMoveMember: (group: ProxyGroup, memberIndex: number, direction: -1 | 1) => void
  onRemoveMember: (group: ProxyGroup, memberIndex: number) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [{ isOver }, drop] = useDrop(() => ({
    accept: "PROXY_MEMBER",
    drop: (item: DragItem) => onDropItem(group, item),
    collect: (monitor) => ({ isOver: monitor.isOver() }),
  }))

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 text-white">
      <div
        className="flex cursor-pointer items-center justify-between gap-4 border-b border-white/10 px-5 py-4"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="flex items-center gap-4">
          <div className="theme-accent-frame rounded-2xl border p-2">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-lg font-semibold">{group.name}</div>
              {group.name === "PROXY" && (
                <Badge className="theme-accent-badge rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.24em]">
                  Primary selector
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
              <span>{group.type}</span>
              <span>{group.members.length} members</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation()
              onMoveGroup(group, -1)
            }}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            disabled={index === total - 1}
            onClick={(event) => {
              event.stopPropagation()
              onMoveGroup(group, 1)
            }}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation()
              onEdit(group)
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(group.id)
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          ref={(node) => {
            drop(node)
          }}
          className={`space-y-3 p-5 ${isOver ? "theme-accent-surface" : ""}`}
        >
          {group.members.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
              Drag proxies, selector groups, or built-in targets here to build the selection order.
            </div>
          ) : (
            group.members.map((member, index) => (
              <div
                key={`${member.id}-${index}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"
              >
                <div>
                  <div className="font-medium text-white">{member.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                    {member.is_target ? describeTarget(member.target_kind) : member.type}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    disabled={index === 0}
                    onClick={() => onMoveMember(group, index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    disabled={index === group.members.length - 1}
                    onClick={() => onMoveMember(group, index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => onRemoveMember(group, index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function Groups() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [groups, setGroups] = useState<ProxyGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [savingGroup, setSavingGroup] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null)
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroup())
  const [proxiesCollapsed, setProxiesCollapsed] = useState(false)
  const [selectorsCollapsed, setSelectorsCollapsed] = useState(false)
  const [builtinsCollapsed, setBuiltinsCollapsed] = useState(false)
  const [tagsCollapsed, setTagsCollapsed] = useState(false)

  const loadPage = async (profileId?: number | null) => {
    const [currentProfile, profileList] = await Promise.all([
      getCurrentProfile(),
      listProfiles(),
    ])
    const nextProfileId = profileId ?? selectedProfileId ?? currentProfile.id
    const [proxyList, groupList] = await Promise.all([
      listProxies(nextProfileId),
      listGroups(nextProfileId),
    ])
    setProfiles(profileList)
    setSelectedProfileId(nextProfileId)
    setProxies(proxyList)
    setGroups(groupList)
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        await loadPage()
      } catch {
        toast.error("Failed to load groups")
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
        const [proxyList, groupList] = await Promise.all([
          listProxies(selectedProfileId),
          listGroups(selectedProfileId),
        ])
        setProxies(proxyList)
        setGroups(groupList)
      } catch {
        toast.error("Failed to refresh groups")
      }
    }
    run()
  }, [selectedProfileId])

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      await loadPage(selectedProfileId)
      toast.success("Groups refreshed")
    } catch {
      toast.error("Failed to refresh groups")
    } finally {
      setRefreshing(false)
    }
  }

  const openCreateDialog = () => {
    setEditingGroup(null)
    setGroupForm(emptyGroup())
    setGroupModalOpen(true)
  }

  const openEditDialog = (group: ProxyGroup) => {
    setEditingGroup(group)
    setGroupForm({
      id: group.id,
      name: group.name,
      type: group.type,
      test_url: group.test_url,
      interval: group.interval,
      tolerance: group.tolerance,
    })
    setGroupModalOpen(true)
  }

  const handleSaveGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProfileId) {
      return
    }
    try {
      setSavingGroup(true)
      const payload = { ...groupForm, profile_id: selectedProfileId }
      if (editingGroup?.id) {
        await updateGroup(editingGroup.id, payload)
        toast.success("Group updated")
      } else {
        await createGroup(payload)
        toast.success("Group created")
      }
      setGroupModalOpen(false)
      await loadPage(selectedProfileId)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to save group")
    } finally {
      setSavingGroup(false)
    }
  }

  const handleDeleteGroup = async (groupId: number) => {
    if (!window.confirm("Delete this group?")) {
      return
    }
    try {
      await deleteGroup(groupId)
      toast.success("Group deleted")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    } catch {
      toast.error("Failed to delete group")
    }
  }

  const handleDropToGroup = async (group: ProxyGroup, item: DragItem) => {
    if (item.kind === "target" && item.name === group.name) {
      toast.error("A selector group cannot target itself")
      return
    }

    try {
      if (item.kind === "target") {
        await attachTargetToGroup(group.id, item.name)
      } else {
        await attachProxyToGroup(group.id, Number(item.id))
      }
      await loadPage(selectedProfileId)
      toast.success(`Added ${item.name} to ${group.name}`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to add member")
    }
  }

  const handleMoveMember = async (group: ProxyGroup, memberIndex: number, direction: -1 | 1) => {
    const nextIndex = memberIndex + direction
    if (nextIndex < 0 || nextIndex >= group.members.length) {
      return
    }

    const nextMembers = [...group.members]
    const [item] = nextMembers.splice(memberIndex, 1)
    nextMembers.splice(nextIndex, 0, item)
    setGroups((current) =>
      current.map((entry) => (entry.id === group.id ? { ...entry, members: nextMembers } : entry)),
    )

    try {
      await reorderGroupMembers(
        group.id,
        nextMembers.map((member) =>
          member.is_target
            ? { target_name: member.name }
            : { proxy_id: Number(member.id) },
        ),
      )
    } catch {
      toast.error("Failed to reorder group members")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    }
  }

  const handleMoveGroup = async (group: ProxyGroup, direction: -1 | 1) => {
    const currentIndex = groups.findIndex((entry) => entry.id === group.id)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= groups.length) {
      return
    }

    const nextGroups = [...groups]
    const [item] = nextGroups.splice(currentIndex, 1)
    nextGroups.splice(nextIndex, 0, item)
    setGroups(nextGroups)

    try {
      await reorderGroups(
        nextGroups.map((entry) => entry.id),
        selectedProfileId ?? undefined,
      )
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to reorder groups")
      if (selectedProfileId) {
        await loadPage(selectedProfileId)
      }
    }
  }

  const handleRemoveMember = async (group: ProxyGroup, memberIndex: number) => {
    const member = group.members[memberIndex]
    try {
      if (member.is_target) {
        await detachTargetFromGroup(group.id, member.name)
      } else {
        await detachProxyFromGroup(group.id, Number(member.id))
      }
      await loadPage(selectedProfileId)
      toast.success("Member removed")
    } catch {
      toast.error("Failed to remove group member")
    }
  }

  const handleCreateProxySelector = async () => {
    if (!selectedProfileId) {
      return
    }

    const existingProxySelector = groups.find((group) => group.name === "PROXY")
    if (existingProxySelector) {
      openEditDialog(existingProxySelector)
      return
    }

    try {
      await createGroup({
        profile_id: selectedProfileId,
        name: "PROXY",
        type: "select",
        test_url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
      })
      await loadPage(selectedProfileId)
      toast.success("Primary PROXY selector created")
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to create PROXY selector")
    }
  }

  const selectorTargets: DragItem[] = groups.map((group) => ({
    kind: "target",
    id: `target-${group.name}`,
    name: group.name,
    targetKind: "group",
  }))
  const tagsSet = new Set<string>()
  proxies.forEach(p => {
    if (p.tags) {
      p.tags.split(',').forEach(tag => tagsSet.add(tag))
    }
  })
  const tagTargets: DragItem[] = Array.from(tagsSet).map((tag) => ({
    kind: "target",
    id: `tag-${tag}`,
    name: `tag:${tag}`,
    targetKind: "tag",
  }))
  const builtinTargets: DragItem[] = [
    {
      kind: "target",
      id: "target-DIRECT",
      name: "DIRECT",
      targetKind: "builtin",
    },
    {
      kind: "target",
      id: "target-REJECT",
      name: "REJECT",
      targetKind: "builtin",
    },
  ]
  const proxySelector = groups.find((group) => group.name === "PROXY")

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-8 px-4 py-6 md:px-8 lg:px-10">
        <section className="rounded-[32px] border border-white/10 bg-[#0e1424d8] p-8 text-white backdrop-blur">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <Badge className="theme-accent-badge rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.28em]">
                Group Composer
              </Badge>
              <div>
                <h1 className="text-4xl font-semibold tracking-tight">Selection Topology</h1>
                <p className="mt-2 max-w-2xl text-slate-300">
                  Build provider groups, nest them into a top-level selector, and tune fallback behavior without dropping back to YAML.
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
                disabled={refreshing}
              >
                <RefreshCw className={refreshing ? "animate-spin" : ""} />
                Refresh
              </Button>
              <Button
                variant="outline"
                className="theme-accent-outline"
                onClick={handleCreateProxySelector}
              >
                <Plus />
                {proxySelector ? "Edit PROXY selector" : "Create PROXY selector"}
              </Button>
              <Dialog open={groupModalOpen} onOpenChange={setGroupModalOpen}>
                <DialogTrigger asChild>
                  <Button className="theme-accent-button" onClick={openCreateDialog}>
                    <Plus />
                    Create group
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingGroup ? "Edit Group" : "Create Group"}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSaveGroup} className="space-y-4 py-4">
                    <Input
                      value={groupForm.name}
                      onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Group name"
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <select
                        value={groupForm.type}
                        onChange={(event) => setGroupForm((current) => ({ ...current, type: event.target.value }))}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="select">select</option>
                        <option value="url-test">url-test</option>
                        <option value="fallback">fallback</option>
                        <option value="load-balance">load-balance</option>
                      </select>
                      <Input
                        value={groupForm.test_url}
                        onChange={(event) => setGroupForm((current) => ({ ...current, test_url: event.target.value }))}
                        placeholder="Probe URL"
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input
                        type="number"
                        value={String(groupForm.interval)}
                        onChange={(event) =>
                          setGroupForm((current) => ({ ...current, interval: Number(event.target.value) || 0 }))
                        }
                        placeholder="Interval"
                      />
                      <Input
                        type="number"
                        value={String(groupForm.tolerance)}
                        onChange={(event) =>
                          setGroupForm((current) => ({ ...current, tolerance: Number(event.target.value) || 0 }))
                        }
                        placeholder="Tolerance"
                      />
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={savingGroup}>
                        {savingGroup ? "Saving..." : editingGroup ? "Save changes" : "Create group"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr] xl:items-start">
          <div className="rounded-[30px] border border-white/10 bg-[#0a101bd6] p-5 backdrop-blur xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">Available Members</div>
                <div className="mt-1 text-sm text-slate-400">
                  Use provider groups as selector targets, then wire them into `PROXY`.
                </div>
              </div>
              <Badge className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-200">
                {proxies.length} nodes
              </Badge>
            </div>
            {loading ? (
              <div className="py-12 text-center text-slate-400">Loading proxies...</div>
            ) : (
              <div className="space-y-5">
                <InventorySection
                  title="Proxies"
                  count={proxies.length}
                  collapsed={proxiesCollapsed}
                  onToggle={() => setProxiesCollapsed((current) => !current)}
                  emptyState={
                    <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                      No proxies available in this profile yet.
                    </div>
                  }
                >
                  {proxies.map((proxy) => (
                    <DraggableProxy key={proxy.id} proxy={proxy} />
                  ))}
                </InventorySection>

                <InventorySection
                  title="Selector Groups"
                  count={selectorTargets.length}
                  collapsed={selectorsCollapsed}
                  onToggle={() => setSelectorsCollapsed((current) => !current)}
                  emptyState={
                    <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                      No selector groups yet. Create provider groups, then add them to `PROXY`.
                    </div>
                  }
                >
                  {selectorTargets.map((target) => (
                    <TargetChip key={target.id} item={target} />
                  ))}
                </InventorySection>

                {tagTargets.length > 0 && (
                  <InventorySection
                    title="Dynamic Tags"
                    count={tagTargets.length}
                    collapsed={tagsCollapsed}
                    onToggle={() => setTagsCollapsed((current) => !current)}
                  >
                    {tagTargets.map((target) => (
                      <TargetChip key={target.id} item={target} />
                    ))}
                  </InventorySection>
                )}

                <InventorySection
                  title="Built-In Targets"
                  count={builtinTargets.length}
                  collapsed={builtinsCollapsed}
                  onToggle={() => setBuiltinsCollapsed((current) => !current)}
                >
                  {builtinTargets.map((target) => (
                    <TargetChip key={target.id} item={target} />
                  ))}
                </InventorySection>

                {proxies.length === 0 && selectorTargets.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
                    Nothing to drag yet for this profile.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4 xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto xl:pr-1">
            {groups.length === 0 ? (
              <div className="rounded-[30px] border border-dashed border-white/10 bg-[#0a101bd6] p-10 text-center text-slate-400 backdrop-blur">
                <Box className="mx-auto mb-3 size-8 opacity-60" />
                No proxy groups exist for this profile yet.
              </div>
            ) : (
              groups.map((group, index) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  index={index}
                  total={groups.length}
                  onDropItem={handleDropToGroup}
                  onDelete={handleDeleteGroup}
                  onEdit={openEditDialog}
                  onMoveGroup={handleMoveGroup}
                  onMoveMember={handleMoveMember}
                  onRemoveMember={handleRemoveMember}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </DndProvider>
  )
}

function TargetChip({ item }: { item: DragItem }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "PROXY_MEMBER",
    item,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }))

  return (
    <div
      ref={(node) => {
        drag(node)
      }}
      className={`rounded-2xl border border-white/10 p-3 text-white ${
        item.targetKind === "builtin" ? "bg-amber-300/10" : item.targetKind === "tag" ? "bg-white/10 border-white/20" : "theme-accent-surface"
      } ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="font-medium">{item.name}</div>
      <div
        className={`mt-1 text-xs uppercase tracking-[0.2em] ${
          item.targetKind === "builtin" ? "text-amber-100/70" : item.targetKind === "tag" ? "text-white/80" : "theme-accent-text"
        }`}
      >
        {describeTarget(item.targetKind)}
      </div>
    </div>
  )
}
