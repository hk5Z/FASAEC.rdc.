
import React, { useState, useEffect, useCallback } from 'react';
import { Role, Agent, PayrollRecord, UnknownRecord } from './types';
import { OFFICIAL_AGENTS } from './constants';
import AdminDashboard from './components/AdminDashboard';
import UserPortal from './components/UserPortal';
import { 
  Users, 
  LayoutDashboard, 
  ShieldAlert, 
  LogOut, 
  UserCircle2,
  Lock,
  ArrowLeft,
  KeyRound,
  Palette,
  PenTool,
  Map as MapIcon,
  Drum,
  PenLine,
  Landmark,
  ShieldCheck,
  Download,
  Monitor,
  Cpu
} from 'lucide-react';

const ADMIN_PASSWORD = "000s4sxwetnd.chk";

const App: React.FC = () => {
  const [role, setRole] = useState<Role>(Role.USER);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  
  const [agents, setAgents] = useState<Agent[]>(OFFICIAL_AGENTS);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [unknownRecords, setUnknownRecords] = useState<UnknownRecord[]>([]);

  // Capture installation prompt
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert("Pour installer le logiciel :\n1. Cliquez sur l'icône 'Installation' (petite flèche) dans votre barre d'adresse Chrome/Edge.\n2. Cliquez sur 'Installer'.");
    }
  };

  const handleSubmission = useCallback((matricule: string, activity: string) => {
    const foundAgent = agents.find(a => a.id.toUpperCase() === matricule.toUpperCase());
    
    if (foundAgent) {
      const newRecord: PayrollRecord = {
        id: Math.random().toString(36).substr(2, 9),
        agentId: foundAgent.id,
        agentName: foundAgent.name,
        date: new Date().toLocaleDateString('fr-FR'),
        activity,
        dailyPay: foundAgent.dailyRate,
        status: 'PENDING'
      };
      setPayrollRecords(prev => [newRecord, ...prev]);
      return { success: true, message: `Prestation validée pour ${foundAgent.name}.` };
    } else {
      const intrusion: UnknownRecord = {
        id: Math.random().toString(36).substr(2, 9),
        submittedId: matricule,
        submittedName: "Inconnu",
        timestamp: new Date().toLocaleString('fr-FR'),
        activity,
        alertLevel: 'HIGH'
      };
      setUnknownRecords(prev => [intrusion, ...prev]);
      return { success: false, message: "Échec d'authentification : Matricule agnat non reconnu. Alerte de sécurité transmise au cabinet." };
    }
  }, [agents]);

  const handleAdminLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsLoggedIn(true);
      setRole(Role.ADMIN);
      setShowPasswordPrompt(false);
      setPasswordError(false);
      setPasswordInput("");
    } else {
      setPasswordError(true);
    }
  };

  return (
    <div className="min-h-screen font-sans text-slate-900 flex flex-col">
      {/* Top System Bar - Simulation Logicielle EXE */}
      <div className="bg-[#001a4d] text-[10px] py-1 px-4 flex justify-between items-center text-white/40 font-mono no-print">
        <div className="flex items-center gap-4">
          <Cpu size={10} />
          <span>FASAEC_SYSTEM_V4.2.EXE - RUNNING_SECURE</span>
        </div>
        <div className="flex gap-4">
          <span>PORT: 8080</span>
          <span>STATUS: ENCRYPTED</span>
        </div>
      </div>

      <header className="bg-white/95 backdrop-blur-md border-b-8 border-[#002164] shadow-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="text-center md:text-left">
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mb-1">RÉPUBLIQUE DÉMOCRATIQUE DU CONGO</div>
              <h1 className="text-xl md:text-3xl font-black text-[#002164] tracking-tighter uppercase leading-none border-l-4 border-[#CE1126] pl-4">
                MINISTÈRE DE LA CULTURE,<br/>ARTS ET PATRIMOINE
              </h1>
              <p className="text-[10px] md:text-[12px] font-bold text-[#CE1126] uppercase tracking-[0.4em] mt-2 bg-[#FDD100]/10 px-4 py-1 rounded-full w-fit">
                Direction du Fonds d'Assistance Sociale (FASAEC)
              </p>
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-4">
              <button 
                onClick={handleInstall}
                className="flex items-center gap-2 bg-[#002164] text-white text-[10px] font-black uppercase px-4 py-2 rounded-lg hover:bg-blue-800 transition-all shadow-lg"
              >
                <Monitor size={12} className="text-[#FDD100]" /> Installer Logiciel (.exe)
              </button>
              <div className="h-10 w-[2px] bg-slate-100 hidden md:block"></div>
              <div className="text-right">
                <div className="text-[9px] font-black text-[#002164] uppercase tracking-widest mb-1">Portail Sécurisé</div>
                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Logiciel Certifié v4.2</div>
              </div>
            </div>
            {isLoggedIn && (
              <button 
                onClick={() => {setIsLoggedIn(false); setRole(Role.USER);}}
                className="flex items-center gap-2 text-[10px] font-black text-white bg-[#CE1126] hover:bg-red-700 px-6 py-2 rounded-full transition-all uppercase mt-4 shadow-lg shadow-red-900/20"
              >
                <LogOut size={12} /> Déconnexion Session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-grow w-full relative z-10">
        {!isLoggedIn ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            {showPasswordPrompt ? (
              <div className="max-w-md w-full glass-panel rounded-[2.5rem] p-12 border-t-[12px] border-[#CE1126] animate-in fade-in zoom-in duration-500 shadow-2xl">
                <div className="flex flex-col items-center text-center mb-10">
                  <div className="bg-red-50 p-6 rounded-full mb-6 border-2 border-red-100">
                    <KeyRound className="w-12 h-12 text-[#CE1126]" />
                  </div>
                  <h2 className="text-2xl font-black text-[#002164] uppercase tracking-tight">Accès Direction Générale</h2>
                  <p className="text-slate-400 text-sm mt-3 font-medium">Saisissez votre clé d'accréditation ministérielle</p>
                </div>
                
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Clé de Cryptage RH</label>
                    <input 
                      type="password" 
                      autoFocus
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                      className={`w-full px-8 py-5 rounded-2xl bg-white border-2 outline-none transition-all font-mono text-center tracking-[0.5em] ${passwordError ? 'border-[#CE1126] ring-4 ring-red-100' : 'border-slate-200 focus:border-[#002164] focus:ring-4 focus:ring-blue-100'}`}
                      placeholder="••••••••"
                    />
                    {passwordError && (
                      <div className="flex items-center gap-2 text-[#CE1126] text-[10px] font-black uppercase mt-4 justify-center animate-bounce">
                        <ShieldAlert size={14} /> Accès Refusé • Tentative Enregistrée
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={() => setShowPasswordPrompt(false)}
                      className="flex-1 py-5 px-6 rounded-2xl bg-slate-50 border-2 border-slate-200 text-slate-500 font-black uppercase text-xs hover:bg-slate-100 transition-all"
                    >
                      Annuler
                    </button>
                    <button 
                      onClick={handleAdminLogin}
                      className="flex-[2] py-5 px-6 rounded-2xl bg-[#002164] text-white font-black uppercase text-xs hover:bg-blue-800 transition-all shadow-xl shadow-blue-900/30"
                    >
                      Dévérouiller
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl w-full">
                <button 
                  onClick={() => setIsLoggedIn(true)}
                  className="group relative glass-panel p-12 rounded-[3.5rem] text-left overflow-hidden hover:scale-[1.03] transition-all border-b-[12px] border-[#002164]"
                >
                  <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.07] transition-all group-hover:scale-110">
                    <Palette size={240} />
                  </div>
                  <div className="relative z-10">
                    <div className="bg-[#FDD100] text-[#002164] w-16 h-16 rounded-2xl flex items-center justify-center mb-10 shadow-xl group-hover:rotate-12 transition-transform">
                      <Drum size={36} />
                    </div>
                    <h3 className="text-4xl font-black text-[#002164] uppercase tracking-tighter leading-none mb-6">ESPACE<br/>PRESTATIONS</h3>
                    <div className="h-1 w-20 bg-[#CE1126] mb-6"></div>
                    <p className="text-slate-500 font-bold uppercase text-[11px] tracking-widest leading-relaxed">
                      Saisie quotidienne des prestations agnat pour le fonds d'assistance sociale.
                    </p>
                    <div className="mt-12 flex items-center gap-4 text-[#002164] font-black text-xs uppercase tracking-[0.3em]">
                      Accéder au portail <div className="w-12 h-[2px] bg-[#002164] rounded-full group-hover:w-20 transition-all"></div>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={() => setShowPasswordPrompt(true)}
                  className="group relative bg-[#002164] p-12 rounded-[3.5rem] text-white text-left overflow-hidden hover:scale-[1.03] transition-all border-b-[12px] border-[#CE1126] shadow-2xl"
                >
                  <div className="absolute top-0 right-0 p-10 opacity-[0.05] group-hover:opacity-[0.1] transition-all group-hover:scale-110">
                    <Landmark size={240} />
                  </div>
                  <div className="relative z-10">
                    <div className="bg-[#CE1126] text-white w-16 h-16 rounded-2xl flex items-center justify-center mb-10 shadow-xl group-hover:rotate-[-12deg] transition-transform">
                      <Lock size={36} />
                    </div>
                    <h3 className="text-4xl font-black text-white uppercase tracking-tighter leading-none mb-6">CABINET<br/>DIRECTION</h3>
                    <div className="h-1 w-20 bg-[#FDD100] mb-6"></div>
                    <p className="text-blue-100 font-bold uppercase text-[11px] tracking-widest leading-relaxed">
                      Interface de gestion des ressources humaines, paie et audit de sécurité.
                    </p>
                    <div className="mt-12 flex items-center gap-4 text-[#FDD100] font-black text-xs uppercase tracking-[0.3em]">
                      Authentification <div className="w-12 h-[2px] bg-[#FDD100] rounded-full group-hover:w-20 transition-all"></div>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            {role === Role.ADMIN ? (
              <AdminDashboard 
                agents={agents} 
                records={payrollRecords} 
                unknowns={unknownRecords}
                setAgents={setAgents}
                setRecords={setPayrollRecords}
              />
            ) : (
              <UserPortal onClockIn={handleSubmission} />
            )}
          </div>
        )}
      </main>

      <footer className="py-10 border-t-4 border-[#002164] mt-20 bg-white/95 backdrop-blur-md relative z-20 no-print">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start">
             <div className="text-[10px] font-black text-[#002164] uppercase tracking-[0.4em] mb-2">SÉCURITÉ D'ÉTAT CERTIFIÉE</div>
             <p className="text-slate-400 text-[8px] font-bold uppercase tracking-widest leading-relaxed text-center md:text-left">
               © 2024 Ministère de la Culture • Logiciel Propriétaire de Gestion RH<br/>
               Signature Numérique: 0x8F2A...E4C9
             </p>
          </div>

          <div className="flex items-center gap-12">
            <ShieldCheck size={24} className="text-[#002164] opacity-20" />
            <Landmark size={24} className="text-[#002164] opacity-20" />
            <Monitor size={24} className="text-[#002164] opacity-20" />
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
