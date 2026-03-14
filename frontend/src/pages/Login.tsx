import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { APP_VERSION } from '@/lib/version'
import { toast } from 'sonner'
import api from '@/lib/api'

export default function Login() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const formData = new URLSearchParams()
            formData.append('username', username)
            formData.append('password', password)
            
            const res = await api.post('/auth/token', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            })
            
            localStorage.setItem('clash_token', res.data.access_token)
            toast.success("Authentication successful!")
            navigate('/')
        } catch (error) {
            toast.error("Invalid credentials")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
            <div className="w-full max-w-sm p-8 bg-card border border-border rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>
                <div className="flex justify-center mb-6">
                    <div className="p-3 bg-primary/10 rounded-full">
                        <Shield className="w-8 h-8 text-primary" />
                    </div>
                </div>
                <h2 className="text-2xl font-bold text-center mb-2">Clash Manager</h2>
                <p className="text-muted-foreground text-center text-sm mb-6">Secure Access Required</p>
                <p className="text-muted-foreground text-center text-xs mb-6 uppercase tracking-[0.24em]">
                    Dashboard v{APP_VERSION}
                </p>
                
                <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                        <Input 
                            type="text" 
                            placeholder="Admin Username" 
                            value={username} 
                            onChange={(e) => setUsername(e.target.value)} 
                            required 
                            className="bg-muted/50"
                        />
                    </div>
                    <div className="space-y-2">
                        <Input 
                            type="password" 
                            placeholder="Password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            required 
                            className="bg-muted/50"
                        />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Authenticating..." : "Login"}
                    </Button>
                </form>
            </div>
        </div>
    )
}
