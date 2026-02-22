import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Clock, 
  CheckCircle2, 
  Plus, 
  Navigation, 
  Trash2,
  ChevronRight,
  Map as MapIcon,
  Compass,
  X,
  Wallet,
  Wifi,
  WifiOff,
  Sparkles,
  CloudSun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, compareAsc } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { GoogleGenAI } from "@google/genai";
import { Stop } from './types';
import { cn } from './lib/utils';
import { supabase } from './lib/supabase';

const ai = new GoogleGenAI({ 
  apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" 
});

export default function App() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'route' | 'list'>('route');
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [aiInsights, setAiInsights] = useState<{
    costs?: string;
    weather?: string;
    recommendations?: string;
    tips?: string;
  } | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Handle Online/Offline Status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load Initial Data
  const loadData = async () => {
    setIsLoading(true);
    
    // 1. Try to load from LocalStorage first (Instant UI)
    const cached = localStorage.getItem('kitatour_stops');
    if (cached) {
      setStops(JSON.parse(cached));
    }

    // 2. If online and Supabase is configured, sync from Cloud
    if (isOnline && supabase) {
      try {
        const { data, error } = await supabase
          .from('stops')
          .select('*')
          .order('order', { ascending: true });

        if (error) throw error;
        if (data) {
          setStops(data);
          localStorage.setItem('kitatour_stops', JSON.stringify(data));
        }
      } catch (err) {
        console.error("Supabase Load Error:", err);
      }
    }
    
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Save/Sync Helper
  const syncData = async (updatedStops: Stop[]) => {
    // Always update local state and storage immediately
    setStops(updatedStops);
    localStorage.setItem('kitatour_stops', JSON.stringify(updatedStops));

    // Try to sync to cloud if online
    if (isOnline && supabase) {
      try {
        // Simple strategy: Upsert all stops
        // In a real app, you'd only sync changes, but for < 10 items this is fine
        const { error } = await supabase
          .from('stops')
          .upsert(updatedStops, { onConflict: 'id' });
        
        if (error) throw error;
      } catch (err) {
        console.error("Supabase Sync Error:", err);
      }
    }
  };

  const addStop = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newStop: Stop = {
      id: crypto.randomUUID(),
      title: formData.get('title') as string,
      address: formData.get('address') as string,
      dateTime: `${formData.get('date')}T${formData.get('time')}`,
      notes: formData.get('notes') as string,
      cost: Number(formData.get('cost')) || 0,
      status: 'planned',
      order: stops.length
    };

    const updated = [...stops, newStop].sort((a, b) => compareAsc(parseISO(a.dateTime), parseISO(b.dateTime)));
    await syncData(updated);
    setIsAdding(false);
  };

  const toggleStatus = async (id: string, forceStatus?: 'planned' | 'visited' | 'skipped') => {
    const updated = stops.map(s => {
      if (s.id === id) {
        const nextStatus = forceStatus || (s.status === 'visited' ? 'planned' : 'visited');
        return { ...s, status: nextStatus };
      }
      return s;
    });
    await syncData(updated);
  };

  const deleteStop = async (id: string) => {
    const updated = stops.filter(s => s.id !== id);
    setStops(updated);
    localStorage.setItem('kitatour_stops', JSON.stringify(updated));

    if (isOnline && supabase) {
      try {
        await supabase.from('stops').delete().eq('id', id);
      } catch (err) {
        console.error("Supabase Delete Error:", err);
      }
    }
  };

  const sortedStops = [...stops].sort((a, b) => compareAsc(parseISO(a.dateTime), parseISO(b.dateTime)));
  const nextStop = sortedStops.find(s => s.status === 'planned');
  const skippedStops = sortedStops.filter(s => s.status === 'skipped');
  const completedStops = sortedStops.filter(s => s.status === 'visited');
  const totalCost = stops.reduce((acc, stop) => acc + (stop.cost || 0), 0);

  // AI Insights Function
  const fetchAiInsights = async (stop: Stop) => {
    // 1. Check Cache First (Offline Support)
    const cacheKey = `ai_cache_${stop.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setAiInsights(JSON.parse(cached));
      return;
    }

    // 2. If Offline and no cache, use Smart Fallback
    if (!isOnline) {
      const fallback = getSmartFallback(stop.title);
      setAiInsights(fallback);
      return;
    }

    // 3. If Online, fetch from Gemini
    setIsLoadingAi(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Berikan informasi singkat dan akurat untuk wisatawan yang akan ke: ${stop.title} (${stop.address}). 
        Gunakan Google Search untuk mendapatkan:
        1. Estimasi biaya (tiket masuk, parkir, makan).
        2. Prakiraan cuaca singkat atau kondisi saat ini.
        3. 2 Rekomendasi tempat menarik/kuliner terdekat.
        4. Tips singkat (misal: waktu terbaik berkunjung).
        
        PENTING: Setiap nilai dalam JSON harus berupa STRING tunggal, jangan gunakan objek bersarang.
        Berikan jawaban dalam format JSON mentah dengan kunci: costs, weather, recommendations, tips. Jangan gunakan markdown.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json"
        }
      });
      
      const data = JSON.parse(response.text || '{}');
      setAiInsights(data);
      // Save to cache for offline use
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (error) {
      console.error("AI Insights Error:", error);
      const fallback = getSmartFallback(stop.title);
      setAiInsights(fallback);
    } finally {
      setIsLoadingAi(false);
    }
  };

  const getSmartFallback = (title: string) => {
    const t = title.toLowerCase();
    let tips = "Siapkan peta offline dan air minum.";
    let costs = "Siapkan uang tunai untuk parkir/jajan.";
    
    if (t.includes('pantai')) {
      tips = "Bawa sunblock, baju ganti, dan kacamata hitam.";
      costs = "Biasanya ada biaya parkir & sewa payung.";
    } else if (t.includes('candi') || t.includes('museum')) {
      tips = "Gunakan sepatu nyaman dan bawa topi.";
      costs = "Siapkan biaya tiket masuk (biasanya Rp 20rb - 100rb).";
    } else if (t.includes('makan') || t.includes('resto') || t.includes('kuliner')) {
      tips = "Cek ulasan terbaru untuk menu andalan.";
      costs = "Estimasi Rp 50rb - 150rb per orang.";
    }

    return {
      costs,
      weather: "Cek langit secara manual (Mode Offline)",
      recommendations: "Tanya warga lokal untuk spot terbaik.",
      tips
    };
  };

  const renderAiValue = (val: any) => {
    if (!val) return "";
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
      return Object.values(val).join(', ');
    }
    return String(val);
  };

  // Trigger AI when next stop changes
  useEffect(() => {
    if (nextStop) {
      fetchAiInsights(nextStop);
    } else {
      setAiInsights(null);
    }
  }, [nextStop?.id]);

  if (isLoading && stops.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-4">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            className="w-10 h-10 border-4 border-stone-200 border-t-stone-900 rounded-full"
          />
          <p className="text-stone-400 font-bold uppercase tracking-widest text-xs">Menyiapkan Perjalanan...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto h-screen md:h-auto md:min-h-screen flex flex-col bg-stone-50 overflow-hidden md:overflow-visible">
      {/* Header */}
      <header className="p-4 md:p-6 pt-8 md:pt-12 bg-white border-b border-stone-100 sticky top-0 z-20 flex-shrink-0">
        <div className="flex justify-between items-end mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-stone-900">KitaTourAja</h1>
              {isOnline ? (
                <span className="flex items-center gap-1 text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                  <Wifi size={8} /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[8px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded uppercase">
                  <WifiOff size={8} /> Offline Mode
                </span>
              )}
            </div>
            <p className="text-stone-500 text-xs md:text-sm font-medium">Yuk Liburan!</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Waktu Sekarang</p>
            <p className="text-sm md:text-lg font-mono font-semibold text-stone-800">
              {format(currentTime, 'HH:mm:ss')}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden md:overflow-visible p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        {/* Left Column: Route & Next Destination */}
        <div className={cn(
          "lg:col-span-7 space-y-6 md:space-y-8 overflow-y-auto md:overflow-visible pb-20 md:pb-0",
          activeTab !== 'route' && "hidden lg:block"
        )}>
          
          {/* Skipped Stops Section */}
          {skippedStops.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Tujuan Terlewati ({skippedStops.length})</h3>
              </div>
              <div className="grid gap-3">
                {skippedStops.map(stop => (
                  <div 
                    key={stop.id}
                    className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-100 rounded-xl text-amber-600">
                        <Clock size={16} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-amber-900">{stop.title}</h4>
                        <p className="text-[10px] text-amber-600">{format(parseISO(stop.dateTime), 'HH:mm')}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => toggleStatus(stop.id, 'planned')}
                      className="px-3 py-1.5 bg-amber-600 text-white text-[10px] font-bold rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      Aktifkan
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Winding Route Progress Tracker */}
          {stops.length > 0 && (
            <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-[32px] border border-stone-100 shadow-sm overflow-hidden">
              <div className="flex justify-between items-center mb-6 md:mb-10">
                <div>
                  <h3 className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest">Peta Perjalanan</h3>
                  <p className="text-[8px] md:text-[10px] text-stone-400 mt-1">Ketuk titik untuk detail</p>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] md:text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                    {completedStops.length} / {stops.length} Selesai
                  </span>
                </div>
              </div>
              
              <div className="relative min-h-[150px] md:min-h-[200px] py-2 md:py-4">
                <div className="flex flex-col space-y-8 md:space-y-12 relative">
                  {sortedStops.map((stop, i) => {
                    const isEven = i % 2 === 0;
                    const isLast = i === sortedStops.length - 1;
                    const isActive = stop.id === nextStop?.id;
                    const isVisited = stop.status === 'visited';

                    return (
                      <div key={stop.id} className="relative">
                        {!isLast && (
                          <div className={cn(
                            "absolute top-5 md:top-6 h-12 md:h-16 w-1/2 border-stone-100 border-dashed transition-colors duration-500",
                            isEven 
                              ? "left-1/2 border-l-2 border-b-2 rounded-bl-[30px] md:rounded-bl-[40px]" 
                              : "right-1/2 border-r-2 border-b-2 rounded-br-[30px] md:rounded-br-[40px]",
                            isVisited && "border-emerald-200"
                          )} />
                        )}

                        <div className={cn(
                          "flex items-center gap-3 md:gap-4",
                          isEven ? "flex-row" : "flex-row-reverse"
                        )}>
                          <div className="relative flex-shrink-0">
                            <motion.div 
                              initial={false}
                              animate={{ 
                                scale: isActive ? 1.4 : 1,
                                backgroundColor: isVisited ? '#10b981' : (isActive ? '#1c1917' : '#e7e5e4')
                              }}
                              className={cn(
                                "w-4 h-4 md:w-6 md:h-6 rounded-full border-2 md:border-4 border-white shadow-md z-10 relative",
                              )}
                            />
                            {isActive && (
                              <motion.div 
                                layoutId="active-dot-glow-winding"
                                className="absolute -inset-1.5 md:-inset-2 bg-stone-900/10 rounded-full -z-0 animate-ping"
                              />
                            )}
                          </div>

                          <div className={cn(
                            "flex flex-col",
                            isEven ? "items-start text-left" : "items-end text-right"
                          )}>
                            <span className={cn(
                              "text-[8px] md:text-[10px] font-bold uppercase tracking-tighter",
                              isVisited ? "text-emerald-500" : (isActive ? "text-stone-900" : "text-stone-300")
                            )}>
                              {format(parseISO(stop.dateTime), 'HH:mm')}
                            </span>
                            <h4 className={cn(
                              "text-[10px] md:text-xs font-extrabold max-w-[80px] md:max-w-[120px] leading-tight truncate",
                              isVisited ? "text-stone-400 line-through" : "text-stone-700"
                            )}>
                              {stop.title}
                            </h4>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Next Destination Highlight */}
          {nextStop ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-stone-900 text-white p-5 md:p-6 shadow-xl shadow-stone-200"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Compass size={100} className="md:w-[120px] md:h-[120px]" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3 md:mb-4">
                  <span className="inline-block px-2 md:px-3 py-0.5 md:py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] md:text-[10px] font-bold uppercase tracking-wider border border-emerald-500/30">
                    Tujuan Sekarang
                  </span>
                </div>
                <h2 className="text-xl md:text-3xl font-bold mb-2 leading-tight">{nextStop.title}</h2>
                <div className="space-y-1 md:space-y-2 mb-4 md:mb-6">
                  <div className="flex items-center text-stone-300 text-xs md:text-sm">
                    <MapPin size={12} className="mr-2 text-emerald-400 md:w-3.5 md:h-3.5" />
                    <span className="line-clamp-1">{nextStop.address}</span>
                  </div>
                  <div className="flex items-center text-stone-300 text-xs md:text-sm">
                    <Clock size={12} className="mr-2 text-emerald-400 md:w-3.5 md:h-3.5" />
                    <span>{format(parseISO(nextStop.dateTime), 'EEEE, d MMMM • HH:mm', { locale: idLocale })}</span>
                  </div>
                </div>
                
                <div className="flex gap-2 md:gap-3">
                  <button 
                    onClick={() => toggleStatus(nextStop.id)}
                    className="flex-1 py-3 md:py-4 bg-white text-stone-900 rounded-xl md:rounded-2xl font-bold text-xs md:text-base flex items-center justify-center gap-2 hover:bg-stone-100 transition-colors active:scale-95"
                  >
                    <CheckCircle2 size={16} className="md:w-[18px] md:h-[18px]" />
                    Selesaikan
                  </button>
                  <button 
                    onClick={() => toggleStatus(nextStop.id, 'skipped')}
                    className="px-3 md:px-4 py-3 md:py-4 bg-stone-800 text-stone-400 rounded-xl md:rounded-2xl font-bold flex items-center justify-center hover:text-white transition-colors active:scale-95"
                    title="Lewati tujuan ini"
                  >
                    <ChevronRight size={16} className="md:w-[18px] md:h-[18px]" />
                  </button>
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nextStop.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 md:px-4 py-3 md:py-4 bg-emerald-500 text-white rounded-xl md:rounded-2xl font-bold flex items-center justify-center hover:bg-emerald-600 transition-colors active:scale-95"
                  >
                    <Navigation size={16} className="md:w-[18px] md:h-[18px]" />
                  </a>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="p-6 md:p-8 rounded-2xl md:rounded-3xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-center space-y-3 md:space-y-4">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-400">
                <MapIcon size={24} className="md:w-8 md:h-8" />
              </div>
              <div>
                <h3 className="font-bold text-stone-800 text-sm md:text-base">Semua tujuan tercapai!</h3>
                <p className="text-xs text-stone-500">Tambahkan tujuan baru untuk memulai petualangan.</p>
              </div>
            </div>
          )}

          {/* AI Smart Insights Section */}
          <AnimatePresence>
            {nextStop && (isOnline || aiInsights) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-indigo-600 rounded-3xl p-6 text-white shadow-xl shadow-indigo-100 relative overflow-hidden"
              >
                <div className="absolute -right-4 -top-4 opacity-10">
                  <Sparkles size={120} />
                </div>
                
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 bg-white/20 rounded-lg">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-widest">AI Smart Guide</h3>
                  {isLoadingAi ? (
                    <motion.div 
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="ml-auto text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded"
                    >
                      Mencari Info Terbaru...
                    </motion.div>
                  ) : !isOnline ? (
                    <div className="ml-auto text-[8px] font-bold bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded border border-amber-500/30 uppercase">
                      Mode Offline
                    </div>
                  ) : (
                    <div className="ml-auto text-[8px] font-bold bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded border border-emerald-500/30 uppercase">
                      Data Tersimpan
                    </div>
                  )}
                </div>

                {aiInsights ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 mb-1">
                          <Wallet size={12} className="text-indigo-200" />
                          <span className="text-[10px] font-bold uppercase text-indigo-100">Estimasi Biaya</span>
                        </div>
                        <p className="text-xs leading-relaxed">{renderAiValue(aiInsights.costs) || "Cek tiket masuk di lokasi."}</p>
                      </div>
                      <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 mb-1">
                          <CloudSun size={12} className="text-indigo-200" />
                          <span className="text-[10px] font-bold uppercase text-indigo-100">Cuaca & Kondisi</span>
                        </div>
                        <p className="text-xs leading-relaxed">{renderAiValue(aiInsights.weather) || "Siapkan payung untuk berjaga-jaga."}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin size={12} className="text-indigo-200" />
                          <span className="text-[10px] font-bold uppercase text-indigo-100">Rekomendasi</span>
                        </div>
                        <p className="text-xs leading-relaxed">{renderAiValue(aiInsights.recommendations) || "Jelajahi area sekitar."}</p>
                      </div>
                      <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 size={12} className="text-indigo-200" />
                          <span className="text-[10px] font-bold uppercase text-indigo-100">Tips Cepat</span>
                        </div>
                        <p className="text-xs leading-relaxed italic">"{renderAiValue(aiInsights.tips)}"</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <p className="text-xs text-indigo-100 font-medium">Menghubungkan ke Google AI untuk panduan perjalanan Anda...</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Timeline */}
        <div className={cn(
          "lg:col-span-5 space-y-6 overflow-y-auto md:overflow-visible pb-20 md:pb-0",
          activeTab !== 'list' && "hidden lg:block"
        )}>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Total Lokasi</p>
              <p className="text-xl font-bold text-stone-900">{stops.length}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Estimasi Biaya</p>
              <p className="text-xl font-bold text-emerald-600">
                Rp {totalCost.toLocaleString('id-ID')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-base md:text-lg font-bold text-stone-900">Rencana Perjalanan</h3>
          </div>

          <div className="relative">
            <div className="timeline-line" />
            <div className="space-y-4 md:space-y-8">
              <AnimatePresence mode="popLayout">
                {sortedStops.map((stop) => (
                  <motion.div 
                    key={stop.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative pl-8 md:pl-10"
                  >
                    <div className={cn(
                      "absolute left-2 top-1.5 w-3 h-3 md:w-4 md:h-4 rounded-full border-2 md:border-4 border-white shadow-sm z-10 transition-colors duration-500",
                      stop.status === 'visited' ? "bg-emerald-500" : "bg-stone-300"
                    )} />

                    <div className={cn(
                      "p-4 md:p-5 rounded-xl md:rounded-2xl transition-all duration-300",
                      stop.status === 'visited' ? "bg-stone-100 opacity-60" : 
                      stop.status === 'skipped' ? "bg-amber-50 border border-amber-100" :
                      "bg-white shadow-sm border border-stone-100"
                    )}>
                      <div className="flex justify-between items-start mb-1 md:mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5 md:mb-1">
                            <p className="text-[8px] md:text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                              {format(parseISO(stop.dateTime), 'HH:mm')}
                            </p>
                            {stop.status === 'skipped' && (
                              <span className="text-[8px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">Terlewati</span>
                            )}
                          </div>
                          <h4 className={cn(
                            "font-bold text-sm md:text-lg leading-tight",
                            stop.status === 'visited' && "line-through text-stone-400",
                            stop.status === 'skipped' && "text-amber-900"
                          )}>
                            {stop.title}
                          </h4>
                        </div>
                        <button 
                          onClick={() => deleteStop(stop.id)}
                          className="p-1.5 md:p-2 text-stone-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} className="md:w-4 md:h-4" />
                        </button>
                      </div>
                      
                      <div className="flex items-center text-stone-500 text-[10px] md:text-xs mb-2 md:mb-3 gap-3">
                        <div className="flex items-center">
                          <MapPin size={10} className="mr-1 flex-shrink-0 md:w-3 md:h-3" />
                          <span className="line-clamp-1">{stop.address}</span>
                        </div>
                        {stop.cost && stop.cost > 0 && (
                          <div className="flex items-center text-emerald-600 font-bold">
                            <Wallet size={10} className="mr-1" />
                            Rp {stop.cost.toLocaleString('id-ID')}
                          </div>
                        )}
                      </div>

                      {stop.notes && (
                        <p className="text-[10px] md:text-xs text-stone-400 italic bg-stone-50 p-2 rounded-lg border border-stone-100 mb-2 md:mb-3">
                          "{stop.notes}"
                        </p>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex gap-3">
                          {stop.status !== 'visited' && (
                            <button 
                              onClick={() => toggleStatus(stop.id, 'visited')}
                              className="text-[10px] md:text-xs font-bold text-emerald-600 flex items-center gap-1 hover:underline"
                            >
                              Selesai <ChevronRight size={10} className="md:w-3 md:h-3" />
                            </button>
                          )}
                          {stop.status === 'skipped' && (
                            <button 
                              onClick={() => toggleStatus(stop.id, 'planned')}
                              className="text-[10px] md:text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline"
                            >
                              Aktifkan Kembali
                            </button>
                          )}
                          {stop.status === 'planned' && (
                            <button 
                              onClick={() => toggleStatus(stop.id, 'skipped')}
                              className="text-[10px] md:text-xs font-bold text-amber-600 flex items-center gap-1 hover:underline"
                            >
                              Lewati
                            </button>
                          )}
                        </div>
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[8px] md:text-[10px] font-bold text-stone-400 flex items-center gap-1 hover:text-stone-600"
                        >
                          <MapIcon size={8} className="md:w-2.5 md:h-2.5" /> Maps
                        </a>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-100 px-4 py-3 flex justify-between items-center z-30">
        <button 
          onClick={() => setActiveTab('route')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors flex-1",
            activeTab === 'route' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <Compass size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Rute</span>
        </button>
        
        <div className="relative -top-6 px-2">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsAdding(true)}
            className="w-14 h-14 bg-stone-900 text-white rounded-full shadow-2xl flex items-center justify-center border-4 border-stone-50"
          >
            <Plus size={24} />
          </motion.button>
        </div>

        <button 
          onClick={() => setActiveTab('list')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors flex-1",
            activeTab === 'list' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <MapIcon size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Rencana</span>
        </button>
      </div>

      {/* Desktop Floating Action Button */}
      <motion.button 
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsAdding(true)}
        className="hidden md:flex fixed bottom-8 right-8 w-16 h-16 bg-stone-900 text-white rounded-full shadow-2xl items-center justify-center z-40"
      >
        <Plus size={32} />
      </motion.button>

      {/* Add Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-stone-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white w-full max-w-lg rounded-t-[32px] md:rounded-[32px] p-6 md:p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl md:text-2xl font-bold text-stone-900">Tujuan Baru</h2>
                <button 
                  onClick={() => setIsAdding(false)}
                  className="p-2 bg-stone-100 rounded-full text-stone-500 hover:bg-stone-200 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={addStop} className="space-y-4 md:space-y-5">
                <div className="space-y-1.5 md:space-y-2">
                  <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Nama Tujuan</label>
                  <input 
                    required
                    name="title"
                    type="text"
                    placeholder="Contoh: Candi Borobudur"
                    className="w-full p-3 md:p-4 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                  />
                </div>

                <div className="space-y-1.5 md:space-y-2">
                  <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Alamat Lengkap</label>
                  <div className="relative">
                    <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input 
                      required
                      name="address"
                      type="text"
                      placeholder="Masukkan alamat..."
                      className="w-full p-3 md:p-4 pl-11 md:pl-12 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className="space-y-1.5 md:space-y-2">
                    <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Tanggal</label>
                    <input 
                      required
                      type="date"
                      name="date"
                      defaultValue={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full p-3 md:p-4 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5 md:space-y-2">
                    <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Jam</label>
                    <input 
                      required
                      type="time"
                      name="time"
                      defaultValue={format(new Date(), 'HH:mm')}
                      className="w-full p-3 md:p-4 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className="space-y-1.5 md:space-y-2">
                    <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Estimasi Biaya (Rp)</label>
                    <input 
                      type="number"
                      name="cost"
                      placeholder="0"
                      className="w-full p-3 md:p-4 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5 md:space-y-2">
                    <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Catatan (Opsional)</label>
                    <input 
                      name="notes"
                      type="text"
                      placeholder="Bawa kamera..."
                      className="w-full p-3 md:p-4 bg-stone-50 border border-stone-100 rounded-xl md:rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm md:text-base"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 md:py-5 bg-stone-900 text-white rounded-xl md:rounded-2xl font-bold text-sm md:text-lg hover:bg-stone-800 transition-all active:scale-95 shadow-lg shadow-stone-200 mt-2"
                >
                  Simpan Tujuan
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
