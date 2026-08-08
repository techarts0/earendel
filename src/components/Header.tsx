import React from 'react';
import { Sparkles, Maximize2, Minimize2, Languages, FolderTree, Trophy, Code2 } from 'lucide-react';
import { Language, translations } from '../i18n/translations';

interface HeaderProps {
  lang: Language;
  setLang: (lang: Language) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  showFileTree: boolean;
  setShowFileTree: (show: boolean) => void;
  showLessons: boolean;
  setShowLessons: (show: boolean) => void;
  showScriptEditor: boolean;
  setShowScriptEditor: (show: boolean) => void;
  completedCount: number;
  totalLessons: number;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  setLang,
  isFullscreen,
  toggleFullscreen,
  showFileTree,
  setShowFileTree,
  showLessons,
  setShowLessons,
  showScriptEditor,
  setShowScriptEditor,
  completedCount,
  totalLessons,
}) => {
  const t = translations[lang];

  return (
    <header className="h-11 px-3 bg-[#0a0d18] border-b border-slate-800 flex items-center justify-between select-none z-30">
      {/* Brand Name */}
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-sky-400 p-0.5 flex items-center justify-center shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-slate-950" />
        </div>
        <span className="font-bold text-sm tracking-wider text-slate-100 font-mono">
          Earendel <span className="text-[10px] text-sky-400 font-sans font-normal opacity-80">Linux TTY</span>
        </span>
      </div>

      {/* Control Actions & Tools */}
      <div className="flex items-center gap-2">
        {/* Toggle File Tree */}
        <button
          onClick={() => setShowFileTree(!showFileTree)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
            showFileTree
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={t.toggleSidebar}
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.toggleSidebar}</span>
        </button>

        {/* Toggle Script Studio */}
        <button
          onClick={() => setShowScriptEditor(!showScriptEditor)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
            showScriptEditor
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title="Shell Studio"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Shell Studio</span>
        </button>

        {/* Toggle Lessons Panel */}
        <button
          onClick={() => setShowLessons(!showLessons)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
            showLessons
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title="Lessons"
        >
          <Trophy className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            Lessons ({completedCount}/{totalLessons})
          </span>
        </button>

        <div className="w-[1px] h-4 bg-slate-800 mx-0.5" />

        {/* Language Switcher */}
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono transition-all"
        >
          <Languages className="w-3.5 h-3.5 text-indigo-400" />
          <span>{lang === 'zh' ? 'English' : '中文'}</span>
        </button>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono shadow-sm transition-all"
          title={isFullscreen ? t.exitFullscreen : t.fullscreen}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{isFullscreen ? t.exitFullscreen : t.fullscreen}</span>
        </button>
      </div>
    </header>
  );
};
