import { useEffect, useState } from "react"
import { Copy, Download, RefreshCw, UploadCloud, FileCog, FileCode2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import api from "@/lib/api"
import { copyText } from "@/lib/copy"

export default function ConfigPreview() {
    const [yaml, setYaml] = useState<string>("")
    const [loading, setLoading] = useState(true)
    const [versions, setVersions] = useState<string[]>([])
    const [uploading, setUploading] = useState(false)

    const fetchConfig = async () => {
        try {
            setLoading(true)
            const res = await api.get('/config/main.yaml', { responseType: 'text' })
            setYaml(res.data)

            const verRes = await api.get('/config/versions')
            setVersions(verRes.data.versions || [])
        } catch (e) {
            toast.error("Failed to fetch generated config")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchConfig()
    }, [])

    const handleCopy = async (text: string) => {
        try {
            await copyText(text)
            toast.success("Copied to clipboard")
        } catch {
            toast.error("Failed to copy")
        }
    }

    const handleDownload = () => {
        const blob = new Blob([yaml], { type: "text/yaml" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "main.yaml"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            setUploading(true)
            const formData = new FormData()
            formData.append('file', file)
            await api.post('/config/upload', formData, {
                headers: { "Content-Type": "multipart/form-data" }
            })
            toast.success("YAML uploaded successfully and loaded to live editor!")
            fetchConfig()
        } catch (e: any) {
            toast.error(e.response?.data?.detail || "Upload failed")
        } finally {
            setUploading(false)
        }
    }

    const activateVersion = async (version: string) => {
        if (!window.confirm("Overwrite current Live DB with this version?")) return
        try {
            await api.post(`/config/activate/${version}`)
            toast.success("Version activated successfully!")
            fetchConfig()
        } catch (e: any) {
            toast.error(e.response?.data?.detail || "Failed to activate")
        }
    }

    const deleteVersion = async (version: string) => {
        if (version === "main.yaml") return
        if (!window.confirm("Permanently delete this config version?")) return
        try {
            await api.delete(`/config/versions?path=${encodeURIComponent(version)}`)
            toast.success("Version deleted!")
            fetchConfig()
        } catch (e: any) {
            toast.error(e.response?.data?.detail || "Failed to delete")
        }
    }

    return (
        <div className="p-8 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Config Versions</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Upload YAML, visualize/edit nodes, and generate subscription host links.</p>
                </div>
                <div className="flex space-x-2">
                    <Button variant="outline" className="relative cursor-pointer" disabled={uploading}>
                        <UploadCloud size={16} className={`mr-2 ${uploading ? 'animate-pulse' : ''}`} />
                        {uploading ? 'Uploading...' : 'Upload YAML (Overwrite DB)'}
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".yaml,.yml" onChange={handleUpload} disabled={uploading} />
                    </Button>
                    <Button variant="outline" onClick={fetchConfig} disabled={loading}><RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
                    <Button onClick={handleDownload} disabled={!yaml}><Download size={16} className="mr-2" /> Download Built YAML</Button>
                </div>
            </div>

            <div className="flex flex-1 gap-6 min-h-0">
                {/* Available Hosted File Column */}
                <div className="w-80 flex flex-col bg-card border rounded-lg overflow-hidden">
                    <div className="p-3 border-b bg-muted/50 font-semibold flex items-center">
                        <FileCog size={16} className="mr-2 text-primary" /> Self-Hosted Versions
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {versions.map(v => (
                            <div key={v} className="flex flex-col p-3 bg-muted/20 border rounded-md">
                                <span className="font-mono text-xs font-semibold break-all text-primary mb-2">{v}</span>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="flex-1 text-[10px] h-7 px-1" onClick={() => handleCopy(`${window.location.origin}/config/download/${v}`)}>
                                        <Copy size={10} className="mr-1" /> Copy URL
                                    </Button>
                                    <Button variant="secondary" size="sm" className="flex-1 text-[10px] h-7 px-1 bg-primary/20 text-primary hover:bg-primary/30" onClick={(e) => { e.stopPropagation(); activateVersion(v); }}>
                                        <FileCode2 size={10} className="mr-1" /> Load DB
                                    </Button>
                                    {v !== "main.yaml" && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500/70 hover:text-red-500 hover:bg-red-500/10 shrink-0" onClick={(e) => { e.stopPropagation(); deleteVersion(v); }}>
                                            <Trash2 size={12} />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {versions.length === 0 && (
                            <div className="text-muted-foreground text-sm text-center mt-10">No versions available.</div>
                        )}
                    </div>
                </div>

                <div className="flex-1 flex flex-col bg-[#1e1e1e] border border-border rounded-lg p-6 font-mono text-sm text-[#d4d4d4] overflow-y-auto shadow-inner relative">
                    <div className="absolute top-2 right-4 flex items-center bg-black/40 px-3 py-1 rounded text-xs text-muted-foreground">
                        <FileCode2 size={12} className="mr-2" /> Live Built (main.yaml)
                    </div>
                    <pre className="whitespace-pre-wrap mt-4">
                        <code dangerouslySetInnerHTML={{ __html: PrismLikeHighlighter(yaml) }} />
                    </pre>
                </div>
            </div>
        </div>
    )
}

// Minimalistic regex highlighter just for the YAML appearance
function PrismLikeHighlighter(text: string) {
    if (!text) return ""
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^(#.*)$/gm, '<span class="text-green-500/70">$1</span>') // Comments
        .replace(/^([a-z0-9_-]+):/gim, '<span class="text-blue-400 font-semibold">$1:</span>') // Keys
        .replace(/:\s(-?\d+)$/gim, ': <span class="text-orange-400">$1</span>') // Numbers
        .replace(/:\s(true|false)$/gim, ': <span class="text-purple-400">$1</span>') // Booleans
        .replace(/:\s(["']?)(.*?)\1$/gim, (match, _p1, p2) => {
            if (match.includes('<span')) return match;
            if (p2 && !["true", "false"].includes(p2) && isNaN(Number(p2))) {
                return `: <span class="text-green-300">"${p2}"</span>`
            }
            return match
        })
}
