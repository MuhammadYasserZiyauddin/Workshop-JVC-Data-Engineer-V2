import React, { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import Plot from 'react-plotly.js';
import { UploadCloud, AlertCircle, BarChart2, Settings, Send, Loader2, Sparkles, CheckSquare, Square, Trash2, Check, RefreshCw, FileText, Copy, X } from 'lucide-react';
import Markdown from 'react-markdown';

declare global {
  interface Window {
    dfd: any;
  }
}

interface PlotConfig {
  type: string;
  x_column: string;
  y_column: string;
  group_by_column: string | null;
  layout_overrides: any;
}

interface QualityRecommendation {
  id: string;
  column: string;
  issue: string;
  suggestion: string;
  action_type: 'drop_duplicates' | 'drop_na' | 'fill_na_median' | 'fill_na_mean' | 'fill_na_zero';
}

export default function App() {
  const [dataFrame, setDataFrame] = useState<any | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  
  const [plotData, setPlotData] = useState<{ traces: any[], layoutConfig: any, xCol: string, yCol: string } | null>(null);
  const [metadata, setMetadata] = useState<{ rows: number, cols: number } | null>(null);
  const [schema, setSchema] = useState<{ name: string, type: string }[] | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Phase 3 States
  const [sidePanelTab, setSidePanelTab] = useState<'chat' | 'cleaning'>('chat');
  const [isAnalyzingQuality, setIsAnalyzingQuality] = useState(false);
  const [qualityRecommendations, setQualityRecommendations] = useState<QualityRecommendation[]>([]);
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());

  // Phase 4 States
  const [cleaningHistory, setCleaningHistory] = useState<string[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  const updateWorkspaceState = (df: any) => {
    if (!df) return;
    try {
      if (df.shape.length !== 2) {
        throw new Error("Invalid DataFrame shape.");
      }
      const rows = df.shape[0];
      const cols = df.shape[1];
      setMetadata({ rows, cols });
      
      const headDf = df.head(10);
      const headJson = window.dfd.toJSON(headDf) as any[];
      setTableData(headJson);
      setColumns(df.columns);

      const types = df.ctypes.values as string[];
      const dtypes = df.columns.map((col: string, i: number) => ({ name: col, type: types[i] }));
      setSchema(dtypes);
      setDataFrame(df);

      setPlotData((prev) => {
        if (!prev) return null;
        if (!df.columns.includes(prev.xCol) && prev.xCol !== 'Index') return null;
        if (!df.columns.includes(prev.yCol)) return null;
        
        const xValues = prev.xCol === 'Index' ? df.index : df[prev.xCol].values;
        const yValues = df[prev.yCol].values;
        
        return {
          ...prev,
          traces: [{ x: xValues, y: yValues, type: prev.traces[0].type || 'bar', marker: { color: '#818cf8', opacity: 0.8 } }]
        };
      });

    } catch (e: any) {
      console.error(e);
      setError("Failed to update workspace: " + e.message);
    }
  };

  const processCSV = (file: File) => {
    setFileName(file.name);
    setFileSize((file.size / 1024 / 1024).toFixed(2) + 'MB');
    setCleaningHistory([]);
    setReportMarkdown(null);
    
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setError("The uploaded CSV file is empty or could not be parsed.");
          return;
        }

        try {
          if (!window.dfd) {
             setError("DanfoJS is still loading or failed to load. Please refresh.");
             return;
          }

          const df = new window.dfd.DataFrame(results.data as any);
          
          if (df.shape.length !== 2) {
            setError("Could not determine DataFrame shape.");
            return;
          }
          
          const rows = df.shape[0];
          const cols = df.shape[1];
          setMetadata({ rows, cols });
          
          const headDf = df.head(10);
          const headJson = window.dfd.toJSON(headDf) as any[];
          setTableData(headJson);
          setColumns(df.columns);

          let xCol = '';
          let yCol = '';
          
          const types = df.ctypes.values as string[];
          const dtypes = df.columns.map((col: string, i: number) => ({ name: col, type: types[i] }));
          setSchema(dtypes);
          
          const xCandidate = dtypes.find((d: any) => d.type === 'string' || d.type === 'datetime');
          const yCandidate = dtypes.find((d: any) => d.type === 'float32' || d.type === 'int32' || d.type === 'float64' || d.type === 'int64');

          if (xCandidate && yCandidate) {
            xCol = xCandidate.name;
            yCol = yCandidate.name;
            
            const xValues = df[xCol].values;
            const yValues = df[yCol].values;
            
            setPlotData({
              traces: [{ x: xValues, y: yValues, type: 'bar', marker: { color: '#818cf8', opacity: 0.8 } }],
              layoutConfig: {},
              xCol, yCol 
            });
            setError(null);
          } else if (yCandidate) {
             xCol = 'Index';
             yCol = yCandidate.name;
             setPlotData({
               traces: [{ x: df.index, y: df[yCol].values, type: 'bar', marker: { color: '#818cf8', opacity: 0.8 } }],
               layoutConfig: {},
               xCol, yCol 
             });
             setError(null);
          } else {
             setPlotData(null);
             setError("No numeric columns found for visualization.");
          }
          
          setDataFrame(df);

        } catch (err: any) {
          console.error(err);
          setError("Error processing data: " + (err.message || String(err)));
        }
      },
      error: (err) => {
        setError("Error parsing CSV: " + err.message);
      }
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      processCSV(file);
    } else {
      setError("Please drop a valid CSV file.");
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processCSV(file);
    }
  };

  const handleGenerateChart = async () => {
    if (!chatInput.trim() || !dataFrame || !schema) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: chatInput, schema }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate chart config.');
      }

      const config: PlotConfig = await response.json();
      
      let dataTraces: any[] = [];
      const xCol = config.x_column;
      const yCol = config.y_column;
      
      if (!dataFrame.columns.includes(xCol) && xCol !== 'Index') {
         throw new Error(`Column ${xCol} not found in dataset.`);
      }
      if (!dataFrame.columns.includes(yCol)) {
         throw new Error(`Column ${yCol} not found in dataset.`);
      }

      const xValues = xCol === 'Index' ? dataFrame.index : dataFrame[xCol].values;
      const yValues = dataFrame[yCol].values;

      if (config.group_by_column && dataFrame.columns.includes(config.group_by_column)) {
        const groupCol = config.group_by_column;
        const groups = Array.from(new Set(dataFrame[groupCol].values));
        
        groups.forEach(group => {
           const mask = dataFrame[groupCol].eq(group);
           const filteredDf = dataFrame.loc({ rows: mask });
           
           if (filteredDf && filteredDf.shape[0] > 0) {
             const grpX = xCol === 'Index' ? filteredDf.index : filteredDf[xCol].values;
             const grpY = filteredDf[yCol].values;
             dataTraces.push({
               x: grpX,
               y: grpY,
               type: config.type,
               name: String(group),
               opacity: 0.8
             });
           }
        });
      } else {
        dataTraces.push({
           x: xValues,
           y: yValues,
           type: config.type,
           marker: { color: '#818cf8', opacity: 0.8 },
        });
      }

      setPlotData({
        traces: dataTraces,
        layoutConfig: config.layout_overrides || {},
        xCol, yCol
      });

    } catch (err: any) {
      console.error(err);
      setError("AI Generation failed: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnalyzeQuality = async () => {
    if (!dataFrame) return;
    setIsAnalyzingQuality(true);
    setError(null);
    try {
      const isNaSum = dataFrame.isNa().sum();
      const missingRaw = isNaSum.values;
      const cols = dataFrame.columns;
      const missingCount: Record<string, number> = {};
      cols.forEach((col: string, idx: number) => {
        missingCount[col] = missingRaw[idx];
      });

      let dupeCount = 0;
      try {
        const rows = window.dfd.toJSON(dataFrame);
        const uniqueRows = new Set(rows.map((r: any) => JSON.stringify(r)));
        dupeCount = rows.length - uniqueRows.size;
      } catch (e) {
        console.warn("Could not calculate exact duplicates:", e);
      }

      const qualityMetadata = {
        rowCount: dataFrame.shape[0],
        colCount: dataFrame.shape[1],
        missingValues: missingCount,
        dtypes: schema,
        duplicateRows: dupeCount
      };

      const res = await fetch('/api/analyze-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: qualityMetadata }),
      });

      if (!res.ok) throw new Error("Failed to analyze data quality: " + (await res.json()).error);
      const data = await res.json();
      setQualityRecommendations(data.recommendations || []);
      setSelectedFixes(new Set((data.recommendations || []).map((r: QualityRecommendation) => r.id)));
    } catch (e: any) {
      console.error(e);
      setError("Failed to analyze quality: " + e.message);
    } finally {
      setIsAnalyzingQuality(false);
    }
  };

  const applySelectedFixes = () => {
    if (!dataFrame) return;
    let df = dataFrame;
    const newLogs: string[] = [];
    try {
      const fixesToApply = qualityRecommendations.filter(r => selectedFixes.has(r.id));
      for (const fix of fixesToApply) {
        if (fix.action_type === 'drop_duplicates') {
           if (typeof df.dropDuplicates === 'function') {
             df = df.dropDuplicates({ keep: 'first', inplace: false });
           } else if (typeof df.drop_duplicates === 'function') {
             df = df.drop_duplicates({ keep: 'first', inplace: false });
           } else {
             const jsonStrArray = window.dfd.toJSON(df).map((r: any) => JSON.stringify(r));
             const uniqueJsonStrArray = Array.from(new Set(jsonStrArray as string[]));
             const uniqueJson = uniqueJsonStrArray.map((str: string) => JSON.parse(str));
             df = new window.dfd.DataFrame(uniqueJson);
           }
           newLogs.push(`Dropped duplicate rows.`);
        } else if (fix.action_type === 'drop_na') {
           df = df.dropNa({ axis: 0 });
           newLogs.push(`Dropped rows containing missing values.`);
        } else if (fix.action_type === 'fill_na_median' || fix.action_type === 'fill_na_mean' || fix.action_type === 'fill_na_zero') {
           if (df.columns.includes(fix.column)) {
             let fillVal;
             let fillMethod = 'zero';
             if (fix.action_type === 'fill_na_median') {
               fillVal = df[fix.column].median();
               fillMethod = 'median';
             } else if (fix.action_type === 'fill_na_mean') {
               fillVal = df[fix.column].mean();
               fillMethod = 'mean';
             } else {
               fillVal = 0;
             }
             df = df.fillNa([fillVal], { columns: [fix.column] });
             newLogs.push(`Filled missing values in column "${fix.column}" using ${fillMethod}.`);
           }
        }
      }
      
      updateWorkspaceState(df);
      setCleaningHistory((prev) => [...prev, ...newLogs]);
      setQualityRecommendations(prev => prev.filter(r => !selectedFixes.has(r.id)));
      setSelectedFixes(new Set());
      
    } catch (e: any) {
      console.error(e);
      setError("Failed to apply fixes: " + e.message);
    }
  };

  const toggleFix = (id: string) => {
    const newSet = new Set(selectedFixes);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedFixes(newSet);
  };

  const handleGenerateReport = async () => {
    if (!dataFrame) return;
    setIsGeneratingReport(true);
    setShowReportModal(true);
    setError(null);

    try {
      let stats = null;
      try {
        const describeDf = dataFrame.describe();
        stats = window.dfd.toJSON(describeDf);
      } catch (e) {
        console.warn("Could not calculate full describe logic: ", e);
      }

      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema,
          stats,
          cleaningHistory,
          chartConfig: plotData ? { xCol: plotData.xCol, yCol: plotData.yCol, type: plotData.traces[0]?.type } : null
        })
      });

      if (!res.ok) throw new Error("Failed to generate report: " + (await res.json()).error);
      const data = await res.json();
      setReportMarkdown(data.report);
    } catch (e: any) {
      console.error(e);
      setError("Report generation failed: " + e.message);
      setShowReportModal(false);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const copyReportInfo = async () => {
    if (reportMarkdown) {
      try {
        await navigator.clipboard.writeText(reportMarkdown);
        alert("Report copied to clipboard!");
      } catch (err) {
        console.error("Failed to copy report", err);
      }
    }
  };

  return (
    <div className="w-full h-full bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden relative">
      {showReportModal && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl w-full max-w-4xl h-full max-h-[85vh] flex flex-col overflow-hidden relative">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/30">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <h2 className="font-bold text-lg text-slate-100 uppercase tracking-tight">Executive Summary Report</h2>
              </div>
              <div className="flex items-center gap-3">
                {reportMarkdown && (
                  <button onClick={copyReportInfo} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 py-1.5 px-3 rounded border border-slate-600 transition">
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                )}
                <button onClick={() => setShowReportModal(false)} className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-grow overflow-y-auto p-8 prose prose-invert prose-indigo max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-indigo-400">
              {isGeneratingReport ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 mt-20">
                   <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                   <p className="font-medium text-lg text-indigo-300">Gemini is synthesizing insights...</p>
                   <p className="text-sm">Analyzing metadata, finding trends, and generating your business story.</p>
                </div>
              ) : (
                reportMarkdown ? (
                  <div className="markdown-body">
                    <Markdown>{reportMarkdown}</Markdown>
                  </div>
                ) : (
                   <div className="text-center text-slate-500">Failed to load report narrative.</div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header / Metadata Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-xl tracking-tight">
            <div className="w-6 h-6 bg-indigo-500 rounded flex items-center justify-center text-slate-950 text-xs italic">V</div>
            VibeAnalyze
          </div>
          <div className="h-4 w-px bg-slate-700"></div>
          <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">Phase 4: Synthesis</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase">Dataset Status</span>
            <span className={`text-xs font-mono ${dataFrame ? 'text-emerald-400' : 'text-slate-500'}`}>
              {dataFrame ? 'LIVE_PROCESS_READY' : 'WAITING_FOR_DATA'}
            </span>
          </div>
          <div className="bg-slate-800/50 rounded-lg px-3 py-1.5 flex gap-4 border border-slate-700">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Rows</span>
              <span className="text-sm font-mono">{metadata ? metadata.rows.toLocaleString() : '-'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Cols</span>
              <span className="text-sm font-mono">{metadata ? metadata.cols.toLocaleString() : '-'}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
               onClick={handleGenerateReport}
               disabled={!dataFrame || isGeneratingReport}
               className="ml-2 flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 text-white px-4 py-1.5 rounded-lg text-[11px] uppercase tracking-widest font-bold shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition"
            >
              {isGeneratingReport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
               Generate Story
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col p-4 gap-4 min-h-0">
        
        {/* Drop Zone Area */}
        <section 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => document.getElementById('csv-upload')?.click()}
          className="h-24 flex-shrink-0 bg-slate-900 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl flex items-center justify-center gap-4 group cursor-pointer transition-colors px-6"
        >
          <input 
            id="csv-upload" 
            type="file" 
            accept=".csv" 
            className="hidden" 
            onChange={handleChange} 
          />
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-slate-700 transition-colors flex-shrink-0">
            <UploadCloud className="w-5 h-5 text-slate-400 group-hover:text-indigo-400 transition-colors" />
          </div>
          <div className="flex flex-col flex-grow">
            <span className="text-sm font-medium">{fileName ? fileName : 'Upload dataset'}</span>
            <span className="text-xs text-slate-500 italic">{fileName ? 'Click to replace or drag new files here.' : 'Drop your CSV here or click to browse'}</span>
          </div>
          {fileName && (
            <div className="ml-auto mr-8 flex gap-2 flex-shrink-0">
              <span className="px-2 py-1 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">CSV {fileSize}</span>
              <span className="px-2 py-1 rounded text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">DANFO_READY</span>
            </div>
          )}
        </section>

        {/* Error State */}
        {error && (
          <div className="bg-red-950/50 border border-red-900 text-red-400 p-3 rounded-xl flex items-center space-x-3 text-sm flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Charts Section with AI Chat */}
        <section className="flex-grow min-h-0 flex gap-4 overflow-hidden">
          {/* Chart Wrapper */}
          <div className="flex-grow bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden relative">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center z-10 bg-slate-900/80">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {plotData ? `${plotData.yCol} vs ${plotData.xCol} (AI Chart)` : 'Analytics Overview'}
              </h3>
              <div className="flex gap-2">
                <button className="p-1 text-slate-500 hover:text-slate-200">
                  <BarChart2 className="w-4 h-4" />
                </button>
                <button className="p-1 text-slate-500 hover:text-slate-200">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-grow flex flex-col relative w-full h-full">
              {plotData ? (
                <div className="absolute inset-0">
                  <Plot
                    data={plotData.traces}
                    layout={{
                      autosize: true,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#94a3b8', family: 'Inter, sans-serif' },
                      xaxis: { 
                        title: { text: plotData.xCol },
                        gridcolor: '#334155',
                        zerolinecolor: '#475569',
                        tickfont: { size: 10 }
                      },
                      yaxis: { 
                        title: { text: plotData.yCol },
                        gridcolor: '#334155',
                        zerolinecolor: '#475569',
                        tickfont: { size: 10 }
                      },
                      margin: { t: 30, r: 20, b: 50, l: 60 },
                      hoverlabel: { bgcolor: '#1e293b', font: { color: '#cbd5e1' } },
                      ...plotData.layoutConfig
                    }}
                    useResizeHandler={true}
                    style={{ width: '100%', height: '100%' }}
                    config={{ displayModeBar: false, responsive: true }}
                  />
                </div>
              ) : (
                <div className="flex-grow flex items-center justify-center p-8">
                  <div className="text-slate-500 text-sm italic">
                    Upload a dataset with numeric columns to see visualization.
                  </div>
                </div>
              )}
               {/* Loading Overlay */}
              {isGenerating && (
                <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-20">
                  <div className="flex flex-col items-center gap-4 bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <span className="text-sm font-medium text-slate-300">Gemini is designing your chart...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Area */}
          <div className="flex-shrink-0 w-80 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
            {/* Tabs */}
            <div className="flex bg-slate-900/80 border-b border-slate-800">
              <button
                onClick={() => setSidePanelTab('chat')}
                className={`flex-1 p-3 text-xs font-semibold uppercase tracking-wider transition hover:bg-slate-800/30 ${
                  sidePanelTab === 'chat' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-500'
                }`}
              >
                AI Chat
              </button>
              <button
                onClick={() => setSidePanelTab('cleaning')}
                className={`flex-1 p-3 text-xs font-semibold uppercase tracking-wider transition hover:bg-slate-800/30 ${
                  sidePanelTab === 'cleaning' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500'
                }`}
              >
                Smart Cleanse
              </button>
            </div>

            {sidePanelTab === 'chat' && (
              <>
                <div className="flex-grow p-4 flex flex-col justify-end gap-4 overflow-y-auto">
                  <div className="bg-slate-800/50 rounded-lg p-3 text-sm text-slate-300 border border-slate-700">
                    Hi! I'm your AI Data Assistant. Upload a CSV, then ask me to change the chart type, grouping, or styling!
                  </div>
                  {dataFrame && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Try asking:</span>
                      <button onClick={() => setChatInput("Make it a scatter plot with a dark theme")} className="text-left text-xs bg-slate-800/80 hover:bg-slate-700 text-indigo-300 py-1.5 px-3 rounded border border-slate-700 transition">"Make it a scatter plot with a dark theme"</button>
                      <button onClick={() => setChatInput("Change to a horizontal bar chart")} className="text-left text-xs bg-slate-800/80 hover:bg-slate-700 text-indigo-300 py-1.5 px-3 rounded border border-slate-700 transition">"Change to a horizontal bar chart"</button>
                    </div>
                  )}
                </div>
                <div className="p-3 bg-slate-950 mt-auto border-t border-slate-800">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      disabled={!dataFrame || isGenerating}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateChart(); }}
                      placeholder={dataFrame ? "Ask Gemini to build a chart..." : "Upload data first"}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 transition-all"
                    />
                    <button 
                      disabled={!dataFrame || isGenerating || !chatInput.trim()}
                      onClick={handleGenerateChart}
                      className="absolute right-2 p-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-md disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {sidePanelTab === 'cleaning' && (
              <div className="flex-grow flex flex-col overflow-hidden bg-slate-900/50">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/80">
                  <div className="text-xs text-slate-400 font-medium">Identify & fix data issues</div>
                  <button
                    disabled={!dataFrame || isAnalyzingQuality}
                    onClick={handleAnalyzeQuality}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 py-1.5 px-3 rounded border border-emerald-500/30 transition disabled:opacity-50"
                  >
                    {isAnalyzingQuality ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Analyze
                  </button>
                </div>

                <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-3">
                  {!dataFrame && (
                    <div className="text-slate-500 text-sm italic text-center mt-10">
                      Upload a dataset to start cleaning.
                    </div>
                  )}
                  {isAnalyzingQuality && (
                     <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                       <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                       <span className="text-xs uppercase tracking-widest font-medium">Profiling Data...</span>
                     </div>
                  )}
                  {dataFrame && !isAnalyzingQuality && qualityRecommendations.length === 0 && (
                     <div className="flex flex-col items-center justify-center h-full gap-3 text-emerald-400 mt-10">
                       <Check className="w-10 h-10 border-2 border-emerald-500/20 rounded-full p-2" />
                       <span className="text-sm font-medium">Dataset is healthy!</span>
                     </div>
                  )}
                  {!isAnalyzingQuality && qualityRecommendations.map((rec) => (
                    <div key={rec.id} className="relative bg-slate-800/80 border border-slate-700 rounded-lg p-3 hover:bg-slate-800 transition group flex gap-3 items-start">
                       <button onClick={() => toggleFix(rec.id)} className="mt-0.5 text-slate-400 hover:text-emerald-400 transition-colors">
                         {selectedFixes.has(rec.id) ? (
                           <CheckSquare className="w-5 h-5 text-emerald-500" />
                         ) : (
                           <Square className="w-5 h-5" />
                         )}
                       </button>
                       <div className="flex flex-col gap-1">
                         <div className="text-xs font-semibold text-slate-300">
                           <span className="text-slate-500 mr-2 md:inline hidden">{rec.column}</span>
                           {rec.issue}
                         </div>
                         <div className="text-[11px] text-slate-400 pr-2">
                           {rec.suggestion}
                         </div>
                       </div>
                    </div>
                  ))}
                </div>

                {qualityRecommendations.length > 0 && !isAnalyzingQuality && (
                  <div className="p-3 bg-slate-950 mt-auto border-t border-slate-800">
                     <button
                       disabled={selectedFixes.size === 0}
                       onClick={applySelectedFixes}
                       className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:hover:bg-emerald-600 transition"
                     >
                       <Trash2 className="w-4 h-4" />
                       Apply Selected ({selectedFixes.size})
                     </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Table Preview Section */}
        <section className="h-[280px] flex-shrink-0 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-slate-900/80 flex items-center">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Head(10) Preview</h3>
          </div>
          <div className="overflow-auto flex-grow relative">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/50 sticky top-0 z-10">
                <tr>
                  {columns.map((col, i) => (
                    <th key={col + i} className="p-2 text-[11px] font-bold text-slate-500 border-b border-slate-800 uppercase tracking-tighter whitespace-nowrap bg-slate-950/90 hover:text-slate-300">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs font-mono">
                {tableData.length > 0 ? tableData.map((row, i) => (
                  <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    {columns.map((col, j) => (
                      <td key={col + j} className="p-2 text-slate-400 whitespace-nowrap">
                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : ''}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={100} className="p-8 text-center text-slate-500 italic border-none">
                      No data loaded
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-2 bg-slate-950/50 border-t border-slate-800 flex justify-center">
            <span className="text-[10px] text-slate-500">
              Displaying first 10 rows of {metadata?.rows.toLocaleString() || '0'} available.
            </span>
          </div>
        </section>
      </main>

      {/* Footer Bar */}
      <footer className="h-8 flex-shrink-0 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] font-mono text-slate-600">
        <div>Engine: Danfo.js Core v1.1.2 | PapaParse Runtime | Gemini AI</div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> FULL_STACK_READY</span>
          <span>Latency: &lt;10ms</span>
        </div>
      </footer>
    </div>
  );
}
