import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { 
  ArrowRight, 
  Code2, 
  Zap, 
  Shield, 
  Globe, 
  TrendingUp, 
  Layers,
  Wallet,
  Activity,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Github,
  Twitter,
  MessageCircle,
  Database,
  Lock,
  BarChart3,
  Coins,
  Landmark,
  FileCode,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import './App.css'

gsap.registerPlugin(ScrollTrigger)

// Particle Network Background Component
const ParticleBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    let animationId: number
    let particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      radius: number
      color: string
    }> = []
    
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    
    const createParticles = () => {
      particles = []
      const particleCount = Math.min(80, Math.floor(window.innerWidth / 20))
      
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: Math.random() * 2 + 1,
          color: Math.random() > 0.5 ? '#00F0FF' : '#7000FF'
        })
      }
    }
    
    const drawParticles = () => {
      ctx.fillStyle = 'rgba(5, 5, 10, 0.1)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      particles.forEach((particle, i) => {
        particle.x += particle.vx
        particle.y += particle.vy
        
        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1
        
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        ctx.fillStyle = particle.color
        ctx.fill()
        
        // Draw connections
        particles.slice(i + 1).forEach((other) => {
          const dx = particle.x - other.x
          const dy = particle.y - other.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          if (distance < 150) {
            ctx.beginPath()
            ctx.moveTo(particle.x, particle.y)
            ctx.lineTo(other.x, other.y)
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.15 * (1 - distance / 150)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        })
      })
      
      animationId = requestAnimationFrame(drawParticles)
    }
    
    resize()
    createParticles()
    drawParticles()
    
    window.addEventListener('resize', () => {
      resize()
      createParticles()
    })
    
    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [])
  
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  )
}

// Navigation Component
const Navigation = () => {
  const [scrolled, setScrolled] = useState(false)
  
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  
  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
      scrolled ? 'glass-strong border-b border-white/10' : ''
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-bold text-xl text-white">
              Augur<span className="text-cyan-400">X</span>
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-2">
            {['Features', 'Architecture', 'Gateway', 'Futarchy', 'SDK'].map((item) => (
              <a 
                key={item}
                href={`#${item.toLowerCase()}`} 
                className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all"
              >
                {item}
              </a>
            ))}
          </div>
          
          <div className="flex items-center gap-3">
            <a href="https://augurx.gitbook.io/augurx" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" className="text-gray-400 hover:text-white hidden sm:flex glass-button">
                Docs
              </Button>
            </a>
            <Button className="bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-void font-semibold shadow-lg shadow-cyan-500/25">
              Get Started
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}

// Hero Section
const HeroSection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.hero-title span',
        { opacity: 0, y: 50 },
        { opacity: 1, y: 0, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.3 }
      )
      
      gsap.fromTo('.hero-subtitle',
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.8 }
      )
      
      gsap.fromTo('.hero-buttons',
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 1 }
      )
      
      gsap.fromTo('.hero-stats',
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 1.2 }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  return (
    <section ref={sectionRef} className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/hero-bg.jpg" 
          alt="" 
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-void/60 via-void/80 to-void" />
      </div>
      
      {/* Glass Orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 glass-orb opacity-30 animate-float-slow" />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 glass-orb opacity-20 animate-float" style={{ animationDelay: '2s' }} />
      
      <div ref={contentRef} className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card-strong mb-8">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm text-gray-300">Now with Circle Gateway Integration</span>
        </div>
        
        <h1 className="hero-title font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
          <span className="inline-block">Permissionless</span>{' '}
          <span className="inline-block text-gradient">Prediction</span>{' '}
          <span className="inline-block">Infrastructure</span>
        </h1>
        
        <p className="hero-subtitle text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto mb-10">
          Build the future of forecasting with our Hybrid LMSR engine, cross-chain liquidity via Circle Gateway, 
          and futarchy governance. Deploy prediction markets in minutes, not months.
        </p>
        
        <div className="hero-buttons flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <a href="https://augurx.gitbook.io/augurx" target="_blank" rel="noopener noreferrer">
            <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-void font-semibold px-8 py-6 text-lg shadow-xl shadow-cyan-500/30">
              Explore Docs
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </a>
          <Button size="lg" variant="outline" className="glass-button text-white hover:bg-white/10 px-8 py-6 text-lg border-white/20">
            View Demo
            <ExternalLink className="w-5 h-5 ml-2" />
          </Button>
        </div>
        
        <div className="hero-stats grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {[
            { value: '<500ms', label: 'Cross-chain Transfer' },
            { value: '$0.01', label: 'Min Seed Capital' },
            { value: '7+', label: 'Supported Chains' },
            { value: '100%', label: 'Solvency Guaranteed' },
          ].map((stat, i) => (
            <div key={i} className="glass-card-strong p-5 hover:scale-105 transition-transform duration-300">
              <div className="text-2xl sm:text-3xl font-bold text-cyan-400">{stat.value}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 rounded-full border-2 border-white/20 flex items-start justify-center p-2 glass">
          <div className="w-1.5 h-3 bg-cyan-400 rounded-full animate-pulse" />
        </div>
      </div>
    </section>
  )
}

// Logo Marquee Section
const LogoMarquee = () => {
  const logos = [
    { name: 'Circle', icon: Coins },
    { name: 'Ethereum', icon: Database },
    { name: 'Solana', icon: Zap },
    { name: 'Arbitrum', icon: Layers },
    { name: 'Base', icon: Shield },
    { name: 'Optimism', icon: TrendingUp },
    { name: 'Polygon', icon: Globe },
    { name: 'Avalanche', icon: Activity },
  ]
  
  return (
    <section className="py-16 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
        <p className="text-center text-sm text-gray-500 uppercase tracking-wider">
          Trusted by leading DeFi protocols
        </p>
      </div>
      
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-void to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-void to-transparent z-10" />
        
        <div className="flex animate-marquee">
          {[...logos, ...logos].map((logo, i) => (
            <div 
              key={i} 
              className="flex items-center gap-3 mx-6 px-6 py-4 glass-card hover:border-cyan-500/30 transition-all cursor-pointer group"
            >
              <logo.icon className="w-6 h-6 text-gray-500 group-hover:text-cyan-400 transition-colors" />
              <span className="text-gray-400 group-hover:text-white transition-colors font-medium whitespace-nowrap">
                {logo.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Problem Section
const ProblemSection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.problem-content',
        { opacity: 0, x: -50 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
      
      gsap.fromTo('.problem-visual',
        { opacity: 0, scale: 0.8 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  return (
    <section ref={sectionRef} id="problem" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="problem-content">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-border-red mb-6">
              <span className="text-sm text-red-400 font-medium">The Problem</span>
            </div>
            
            <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
              The Liquidity <span className="text-red-400">Trap</span>
            </h2>
            
            <p className="text-lg text-gray-400 mb-8">
              Traditional prediction markets require massive capital subsidies to bootstrap liquidity. 
              Market creators risk significant capital just to enable trading, making permissionless 
              market creation economically unviable.
            </p>
            
            <div className="space-y-4">
              {[
                'High upfront capital requirements (b × ln(n))',
                'Creators risk full subsidy amount',
                'Limited market creation due to capital constraints',
                'Complex liquidity management',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 glass-panel p-3">
                  <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center mt-0.5">
                    <span className="text-red-400 text-xs">×</span>
                  </div>
                  <span className="text-gray-400">{item}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="problem-visual relative">
            <div className="glass-card-strong rounded-2xl p-8 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-8">
                  <span className="text-gray-400">Pure LMSR Required Capital</span>
                  <span className="text-red-400 font-mono font-bold text-xl">$693+</span>
                </div>
                
                <div className="h-5 bg-white/5 rounded-full overflow-hidden mb-4 glass-input">
                  <div className="h-full w-[95%] bg-gradient-to-r from-red-500 to-red-600 rounded-full shadow-lg shadow-red-500/30" />
                </div>
                
                <div className="grid grid-cols-3 gap-4 mt-8">
                  {[
                    { label: 'Subsidy Risk', value: 'High' },
                    { label: 'Creator Deposit', value: '$693' },
                    { label: 'Accessibility', value: 'Low' },
                  ].map((stat, i) => (
                    <div key={i} className="text-center p-4 glass-panel">
                      <div className="text-red-400 font-bold text-lg">{stat.value}</div>
                      <div className="text-xs text-gray-500">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Decorative elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-red-500/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-red-500/5 rounded-full blur-3xl" />
          </div>
        </div>
      </div>
    </section>
  )
}

// Solution Section - Hybrid LMSR
const SolutionSection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.solution-content',
        { opacity: 0, x: 50 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
      
      gsap.fromTo('.solution-image',
        { opacity: 0, scale: 0.9 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  return (
    <section ref={sectionRef} id="architecture" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="solution-image relative order-2 lg:order-1">
            <div className="relative rounded-2xl overflow-hidden glass-card-strong p-2">
              <img 
                src="/engine-3d.jpg" 
                alt="Hybrid LMSR Engine" 
                className="w-full h-auto rounded-xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-void/50 to-transparent rounded-2xl" />
            </div>
            
            {/* Floating annotations */}
            <div className="absolute -top-2 left-8 glass-card-strong rounded-xl px-4 py-3 animate-float">
              <span className="text-sm text-cyan-400 font-mono font-medium">LMSR Pricing Engine</span>
            </div>
            <div className="absolute -bottom-2 right-8 glass-card-strong rounded-xl px-4 py-3 animate-float" style={{ animationDelay: '1s' }}>
              <span className="text-sm text-purple-400 font-mono font-medium">Parimutuel Settlement</span>
            </div>
            
            {/* Glow effects */}
            <div className="absolute -top-8 -left-8 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-8 -right-8 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="solution-content order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-border-cyan mb-6">
              <span className="text-sm text-cyan-400 font-medium">The Solution</span>
            </div>
            
            <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
              Hybrid <span className="text-gradient">LMSR</span> Architecture
            </h2>
            
            <p className="text-lg text-gray-400 mb-8">
              We decouple pricing from settlement. LMSR serves exclusively as the pricing layer 
              to set dynamic share prices, while parimutuel pools ensure 100% solvency without 
              requiring large upfront capital.
            </p>
            
            <div className="space-y-4 mb-8">
              {[
                { 
                  title: 'LMSR Pricing Engine', 
                  desc: 'Dynamic price discovery with adaptive b parameter',
                  icon: TrendingUp
                },
                { 
                  title: 'Parimutuel Settlement', 
                  desc: 'Winners split the pool proportionally - always solvent',
                  icon: Wallet
                },
                { 
                  title: 'Minimal Seed Capital', 
                  desc: 'Start with as little as $0.01',
                  icon: Coins
                },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4 glass-card p-4 hover:border-cyan-500/30 transition-all group">
                  <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-cyan-500/20 transition-colors">
                    <item.icon className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div>
                    <h4 className="text-white font-medium mb-1">{item.title}</h4>
                    <p className="text-sm text-gray-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="glass-card-strong rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400">Hybrid LMSR Required Capital</span>
                <span className="text-cyan-400 font-mono font-bold text-xl">$0.01</span>
              </div>
              <div className="h-4 bg-white/5 rounded-full overflow-hidden glass-input">
                <div className="h-full w-[1%] bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full shadow-lg shadow-cyan-500/30" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// Circle Gateway Section
const GatewaySection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.gateway-content',
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
      
      gsap.fromTo('.gateway-image',
        { opacity: 0, scale: 0.95 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  const chains = [
    { name: 'Ethereum', color: '#627EEA' },
    { name: 'Solana', color: '#00D4AA' },
    { name: 'Arbitrum', color: '#28A0F0' },
    { name: 'Base', color: '#0052FF' },
    { name: 'Optimism', color: '#FF0420' },
    { name: 'Polygon', color: '#8247E5' },
    { name: 'Avalanche', color: '#E84142' },
  ]
  
  return (
    <section ref={sectionRef} id="gateway" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-purple-500/5" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-border-cyan mb-6">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-sm text-cyan-400 font-medium">Cross-Chain</span>
          </div>
          
          <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
            Unified <span className="text-gradient">Cross-Chain</span> Liquidity
          </h2>
          
          <p className="text-lg text-gray-400 max-w-3xl mx-auto">
            Deposit USDC on any chain. Trade on any chain. Circle Gateway enables sub-500ms 
            cross-chain transfers with a unified balance across all supported networks.
          </p>
        </div>
        
        <div className="gateway-image mb-16">
          <div className="relative rounded-2xl overflow-hidden glass-card-strong p-2">
            <img 
              src="/gateway-visual.jpg" 
              alt="Circle Gateway Cross-Chain" 
              className="w-full h-auto rounded-xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-void via-transparent to-transparent rounded-2xl" />
          </div>
        </div>
        
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {[
            { 
              title: 'Deposit Anywhere', 
              desc: 'Deposit USDC to non-custodial Gateway Wallet contracts on any supported chain',
              icon: Wallet,
              color: 'cyan'
            },
            { 
              title: 'Unified Balance', 
              desc: 'Access your entire USDC balance instantly across all supported blockchains',
              icon: Database,
              color: 'purple'
            },
            { 
              title: 'Instant Transfer', 
              desc: 'Mint USDC on any destination chain in under 500ms with a single API call',
              icon: Zap,
              color: 'cyan'
            },
          ].map((item, i) => (
            <div key={i} className="glass-card-strong p-6 hover:border-cyan-500/30 transition-all duration-300 group">
              <div className={`w-14 h-14 rounded-2xl bg-${item.color}-500/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform shadow-lg shadow-${item.color}-500/10`}>
                <item.icon className={`w-7 h-7 text-${item.color}-400`} />
              </div>
              <h3 className="text-white font-semibold text-lg mb-3">{item.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
        
        <div className="glass-card-strong rounded-2xl p-8">
          <h3 className="text-white font-semibold mb-6 text-center text-lg">Supported Chains</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {chains.map((chain, i) => (
              <div 
                key={i} 
                className="flex items-center gap-2 px-5 py-3 rounded-xl glass-panel hover:bg-white/10 transition-all cursor-pointer group"
              >
                <div 
                  className="w-3 h-3 rounded-full shadow-lg" 
                  style={{ backgroundColor: chain.color, boxShadow: `0 0 10px ${chain.color}40` }}
                />
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{chain.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// Futarchy Section
const FutarchySection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.futarchy-content',
        { opacity: 0, x: -30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
      
      gsap.fromTo('.futarchy-image',
        { opacity: 0, x: 30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  return (
    <section ref={sectionRef} id="futarchy" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="futarchy-content">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-border-purple mb-6">
              <Landmark className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-purple-400 font-medium">Governance</span>
            </div>
            
            <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
              Vote on Values, <span className="text-gradient">Bet on Beliefs</span>
            </h2>
            
            <p className="text-lg text-gray-400 mb-8">
              Our Futarchy engine lets markets decide. Create conditional markets for governance 
              proposals and let the wisdom of the crowd guide your DAO. Proposed by economist 
              Robin Hanson, futarchy replaces token-weighted voting with market-based decision making.
            </p>
            
            <div className="space-y-4 mb-8">
              {[
                { title: 'Values Formation', desc: 'Community defines success metrics through democratic processes' },
                { title: 'Information Sharing', desc: 'Conditional prediction markets price expected impact of proposals' },
                { title: 'Policy Recommendation', desc: 'Higher market price determines implemented policy' },
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-4 glass-card p-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-purple-400 font-bold">{i + 1}</span>
                  </div>
                  <div>
                    <h4 className="text-white font-medium mb-1">{step.title}</h4>
                    <p className="text-sm text-gray-500">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl glass-border-purple">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-purple-400">Superior Information Aggregation</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl glass-border-cyan">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-cyan-400">Manipulation Resistant</span>
              </div>
            </div>
          </div>
          
          <div className="futarchy-image relative">
            <div className="relative rounded-2xl overflow-hidden glass-card-strong p-2">
              <img 
                src="/futarchy-visual.jpg" 
                alt="Futarchy Governance" 
                className="w-full h-auto rounded-xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-void/50 to-transparent rounded-2xl" />
            </div>
            
            {/* Stats overlay */}
            <div className="absolute bottom-6 left-6 right-6 glass-card-strong rounded-xl p-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 glass-panel rounded-lg">
                  <div className="text-3xl font-bold text-cyan-400">75%</div>
                  <div className="text-xs text-gray-500">Pass Market</div>
                </div>
                <div className="text-center p-3 glass-panel rounded-lg">
                  <div className="text-3xl font-bold text-purple-400">25%</div>
                  <div className="text-xs text-gray-500">Fail Market</div>
                </div>
              </div>
            </div>
            
            {/* Glow effects */}
            <div className="absolute -top-8 -right-8 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-8 -left-8 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl" />
          </div>
        </div>
      </div>
    </section>
  )
}

// Market Lifecycle Section
const LifecycleSection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.lifecycle-card',
        { opacity: 0, y: 50 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.15,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  const steps = [
    {
      title: 'Create',
      desc: 'Minimal seed capital required. Define your market question, outcomes, and resolution criteria.',
      icon: FileCode,
      color: 'cyan',
      details: ['As low as $0.01 seed', 'Binary or categorical outcomes', 'Oracle specification']
    },
    {
      title: 'Trade',
      desc: 'Continuous liquidity via LMSR pricing engine. Dynamic prices based on trading activity.',
      icon: TrendingUp,
      color: 'purple',
      details: ['Always liquid', 'Price = Probability', 'Adaptive b parameter']
    },
    {
      title: 'Resolve',
      desc: 'Oracle or DAO verification determines the winning outcome. Transparent and tamper-resistant.',
      icon: CheckCircle2,
      color: 'cyan',
      details: ['Multi-oracle support', 'DAO fallback', 'Trustless resolution']
    },
    {
      title: 'Settle',
      desc: 'Automatic parimutuel distribution. Winners split the pool proportionally.',
      icon: Wallet,
      color: 'purple',
      details: ['100% solvency', 'Proportional payout', 'Instant redemption']
    },
  ]
  
  return (
    <section ref={sectionRef} id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
            Market <span className="text-gradient">Lifecycle</span>
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            From creation to settlement, our infrastructure handles every step of the prediction market lifecycle.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div 
              key={i} 
              className="lifecycle-card glass-card-strong p-6 hover:border-cyan-500/30 transition-all duration-300 group relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-${step.color}-500 to-${step.color}-400`} />
              
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-12 h-12 rounded-xl bg-${step.color}-500/10 flex items-center justify-center shadow-lg shadow-${step.color}-500/10`}>
                  <step.icon className={`w-6 h-6 text-${step.color}-400`} />
                </div>
                <span className="text-gray-500 text-sm font-mono">0{i + 1}</span>
              </div>
              
              <h3 className="text-white font-semibold text-xl mb-3">{step.title}</h3>
              <p className="text-sm text-gray-500 mb-5 leading-relaxed">{step.desc}</p>
              
              <div className="space-y-2">
                {step.details.map((detail, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <ChevronRight className={`w-4 h-4 text-${step.color}-400`} />
                    <span className="text-xs text-gray-400">{detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-16 relative rounded-2xl overflow-hidden glass-card-strong p-2">
          <img 
            src="/lifecycle-visual.jpg" 
            alt="Market Lifecycle" 
            className="w-full h-auto rounded-xl"
          />
        </div>
      </div>
    </section>
  )
}

// SDK Section
const SDKSection = () => {
  const sectionRef = useRef<HTMLElement>(null)
  const [activeTab, setActiveTab] = useState('typescript')
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.sdk-content',
        { opacity: 0, x: -30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
      
      gsap.fromTo('.sdk-code',
        { opacity: 0, x: 30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          }
        }
      )
    }, sectionRef)
    
    return () => ctx.revert()
  }, [])
  
  const codeExamples = {
    typescript: `import { AugurX } from '@augurx/sdk';
import { Connection, PublicKey } from '@solana/web3.js';

// Initialize the SDK
const augurx = new AugurX({
  connection: new Connection('https://api.mainnet-beta.solana.com'),
  wallet: new PublicKey('your-wallet-address')
});

// Create a prediction market
const market = await augurx.createMarket({
  question: "Will ETH hit $5,000 by end of 2025?",
  outcomes: ["Yes", "No"],
  resolutionTime: new Date("2025-12-31"),
  seedCapital: 0.01, // Minimal seed in USDC
  oracle: "chainlink"
});

console.log('Market created:', market.address);`,
    
    solidity: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@predicx/contracts/HybridLMSR.sol";

contract MyPredictionMarket is HybridLMSR {
    constructor(
        string memory _question,
        string[] memory _outcomes,
        uint256 _resolutionTime,
        address _oracle
    ) HybridLMSR(_question, _outcomes, _resolutionTime, _oracle) {
        // Market initialized with minimal seed
    }
    
    function trade(uint256 outcomeIndex, uint256 amount) external {
        _trade(outcomeIndex, amount, msg.sender);
    }
}`,
    
    python: `from augurx import AugurXClient
import asyncio

async def main():
    client = AugurXClient(
        api_key="your-api-key",
        environment="mainnet"
    )
    
    # Get market data
    market = await client.get_market(
        address="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
    )
    
    print("Current prices:", market.prices)
    print("Total volume: $", market.volume)
    
    # Place a trade
    tx = await client.trade(
        market_address=market.address,
        outcome_index=0,  # Yes
        amount_usdc=100
    )
    
    print("Trade executed:", tx.signature)

asyncio.run(main())`
  }
  
  return (
    <section ref={sectionRef} id="sdk" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="sdk-content">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-border-cyan mb-6">
              <Code2 className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-cyan-400 font-medium">Developer SDK</span>
            </div>
            
            <h2 className="font-heading text-4xl sm:text-5xl font-bold text-white mb-6">
              Build in <span className="text-gradient">Minutes</span>
            </h2>
            
            <p className="text-lg text-gray-400 mb-8">
              Simple, clean APIs. Deploy a prediction market in 5 lines of code. 
              Available for TypeScript, Python, and Solidity.
            </p>
            
            <div className="space-y-4 mb-8">
              {[
                { icon: Zap, text: 'TypeScript/JavaScript SDK with full type safety' },
                { icon: Lock, text: 'Python SDK for backend integrations' },
                { icon: Database, text: 'Solidity contracts for on-chain deployment' },
                { icon: Globe, text: 'Circle Gateway integration built-in' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 glass-panel p-3">
                  <item.icon className="w-5 h-5 text-cyan-400" />
                  <span className="text-gray-400">{item.text}</span>
                </div>
              ))}
            </div>
            
            <div className="flex flex-wrap gap-3">
              <Button className="bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-void font-semibold shadow-lg shadow-cyan-500/25">
                <Github className="w-4 h-4 mr-2" />
                View on GitHub
              </Button>
              <a href="https://augurx.gitbook.io/augurx" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="glass-button text-white hover:bg-white/10 border-white/20">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Documentation
                </Button>
              </a>
            </div>
          </div>
          
          <div className="sdk-code">
            <div className="glass-card-strong rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 bg-white/5 border-b border-white/10">
                <div className="flex gap-2">
                  {['typescript', 'solidity', 'python'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${
                        activeTab === tab 
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/50" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                  <div className="w-3 h-3 rounded-full bg-green-500/50" />
                </div>
              </div>
              
              <div className="p-5 overflow-x-auto">
                <pre className="text-sm font-mono text-gray-300">
                  {codeExamples[activeTab as keyof typeof codeExamples].split('\n').map((line, i) => (
                    <div key={i} className="flex">
                      <span className="text-gray-600 w-8 flex-shrink-0 select-none">{i + 1}</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// CTA Section
const CTASection = () => {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-3xl" />
      </div>
      
      {/* Glass Orbs */}
      <div className="absolute top-1/4 left-1/4 w-32 h-32 glass-orb opacity-20 animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-24 h-24 glass-orb opacity-15 animate-float-slow" />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative text-center">
        <div className="glass-card-strong p-12 rounded-3xl">
          <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
            Ready to predict the <span className="text-gradient">future</span>?
          </h2>
          
          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the next generation of prediction markets. Deploy your first market in minutes 
            with our Hybrid LMSR infrastructure and Circle Gateway integration.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-void font-semibold px-8 py-6 text-lg shadow-xl shadow-cyan-500/30">
              Get API Key
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <a href="https://augurx.gitbook.io/augurx" target="_blank" rel="noopener noreferrer">
              <Button size="lg" variant="outline" className="glass-button text-white hover:bg-white/10 px-8 py-6 text-lg border-white/20">
                Read Documentation
                <ExternalLink className="w-5 h-5 ml-2" />
              </Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// Footer
const Footer = () => {
  const links = {
    Product: ['Features', 'Pricing', 'Changelog', 'Roadmap'],
    Developers: ['Documentation', 'API Reference', 'SDKs', 'GitHub'],
    Company: ['About', 'Blog', 'Careers', 'Contact'],
    Legal: ['Privacy', 'Terms', 'Security'],
  }
  
  return (
    <footer className="py-16 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="font-heading font-bold text-xl text-white">
                Augur<span className="text-cyan-400">X</span>
              </span>
            </div>
            <p className="text-gray-500 mb-6 max-w-sm">
              Permissionless prediction market infrastructure with Hybrid LMSR,
              Circle Gateway integration, and Futarchy governance.
            </p>
            <div className="flex gap-3">
              <a href="#" className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center hover:bg-cyan-500/20 transition-colors">
                <Twitter className="w-5 h-5 text-gray-400 hover:text-cyan-400" />
              </a>
              <a href="#" className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center hover:bg-cyan-500/20 transition-colors">
                <Github className="w-5 h-5 text-gray-400 hover:text-cyan-400" />
              </a>
              <a href="#" className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center hover:bg-cyan-500/20 transition-colors">
                <MessageCircle className="w-5 h-5 text-gray-400 hover:text-cyan-400" />
              </a>
            </div>
          </div>
          
          {Object.entries(links).map(([category, items]) => (
            <div key={category}>
              <h4 className="text-white font-semibold mb-4">{category}</h4>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item}>
                    <a
                      href={item === 'Documentation' ? 'https://augurx.gitbook.io/augurx' : '#'}
                      target={item === 'Documentation' ? '_blank' : undefined}
                      rel={item === 'Documentation' ? 'noopener noreferrer' : undefined}
                      className="text-gray-500 hover:text-cyan-400 transition-colors text-sm"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        
        <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-gray-600 text-sm">
            © 2026 PredicX. All rights reserved.
          </p>
          <p className="text-gray-600 text-sm">
            Built with <span className="text-cyan-400">♥</span> for the future of forecasting
          </p>
        </div>
      </div>
    </footer>
  )
}

// Main App Component
function App() {
  useEffect(() => {
    // Initialize smooth scroll
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a[href^="#"]')
      if (anchor) {
        e.preventDefault()
        const id = anchor.getAttribute('href')?.slice(1)
        if (id) {
          const element = document.getElementById(id)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' })
          }
        }
      }
    }
    
    document.addEventListener('click', handleAnchorClick)
    return () => document.removeEventListener('click', handleAnchorClick)
  }, [])
  
  return (
    <div className="min-h-screen bg-void text-white relative">
      <ParticleBackground />
      <Navigation />
      
      <main className="relative z-10">
        <HeroSection />
        <LogoMarquee />
        <ProblemSection />
        <SolutionSection />
        <GatewaySection />
        <FutarchySection />
        <LifecycleSection />
        <SDKSection />
        <CTASection />
      </main>
      
      <Footer />
    </div>
  )
}

export default App
