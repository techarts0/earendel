import React from 'react';
import { LESSONS, Lesson } from '../data/lessons';
import { CheckCircle2, Circle, HelpCircle, ArrowRight, Award, Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';

interface LessonPanelProps {
  currentLessonId: number;
  setCurrentLessonId: (id: number) => void;
  completedLessons: Set<number>;
  onFillCommand: (cmd: string) => void;
}

export const LessonPanel: React.FC<LessonPanelProps> = ({
  currentLessonId,
  setCurrentLessonId,
  completedLessons,
  onFillCommand,
}) => {
  const currentLesson = LESSONS.find((l) => l.id === currentLessonId) || LESSONS[0];

  const handleNext = () => {
    if (currentLessonId < LESSONS.length) {
      setCurrentLessonId(currentLessonId + 1);
    }
  };

  return (
    <div className="w-full h-full flex flex-col glass-panel overflow-hidden border border-slate-800">
      {/* Header */}
      <div className="h-10 px-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          零基础 Linux 实战关卡
        </span>
        <span className="text-xs text-amber-400 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
          已完成 {completedLessons.size} / {LESSONS.length}
        </span>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Lesson List */}
        <div className="w-full md:w-64 bg-slate-950/50 border-r border-slate-800 p-2 overflow-y-auto flex flex-col gap-1">
          {LESSONS.map((lesson) => {
            const isDone = completedLessons.has(lesson.id);
            const isCurrent = lesson.id === currentLessonId;

            return (
              <button
                key={lesson.id}
                onClick={() => setCurrentLessonId(lesson.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
                  isCurrent
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-medium'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-600 shrink-0" />
                  )}
                  <span className="truncate">{lesson.title}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Side: Active Lesson Detail */}
        <div className="flex-1 p-5 overflow-y-auto flex flex-col justify-between bg-[#0b0e1a]">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {currentLesson.category}
              </span>
              {completedLessons.has(currentLesson.id) && (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                  <Award className="w-4 h-4" /> 本关已通关！
                </span>
              )}
            </div>

            <h2 className="text-lg font-bold text-slate-100 mb-3">{currentLesson.title}</h2>
            <p className="text-sm text-slate-300 leading-relaxed mb-6">{currentLesson.description}</p>

            {/* Hint Box */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 mb-2">
                <HelpCircle className="w-4 h-4" /> 提示与目标指令
              </div>
              <p className="text-xs text-slate-400 mb-3">{currentLesson.hint}</p>

              <div className="flex items-center gap-2">
                <code className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono text-emerald-400">
                  {currentLesson.commandTarget}
                </code>
                <button
                  onClick={() => onFillCommand(currentLesson.commandTarget)}
                  className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 text-xs font-medium border border-sky-500/20 transition-all"
                >
                  填入终端执行
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Next Button */}
          <div className="flex justify-end pt-4 border-t border-slate-900">
            <button
              onClick={handleNext}
              disabled={currentLessonId >= LESSONS.length}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl shadow-lg transition-all"
            >
              下一关卡 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
