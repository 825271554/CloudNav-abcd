import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Pin, Wand2, Trash2, Tag } from 'lucide-react';
import { LinkItem, Category, AIConfig } from '../types';
import { generateLinkDescription, suggestCategory } from '../services/geminiService';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (link: Omit<LinkItem, 'id' | 'createdAt'>) => void;
  onDelete?: (id: string) => void;
  categories: Category[];
  initialData?: LinkItem;
  aiConfig: AIConfig;
  defaultCategoryId?: string;
  availableTags?: string[];
}

const LinkModal: React.FC<LinkModalProps> = ({ isOpen, onClose, onSave, onDelete, categories, initialData, aiConfig, defaultCategoryId, availableTags = [] }) => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'common');
  const [pinned, setPinned] = useState(false);
  const [icon, setIcon] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [isFetchingIcon, setIsFetchingIcon] = useState(false);
  const [autoFetchIcon, setAutoFetchIcon] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  
  // 当模态框关闭时，重置批量模式为默认关闭状态
  useEffect(() => {
    if (!isOpen) {
      setBatchMode(false);
      setShowSuccessMessage(false);
    }
  }, [isOpen]);
  
  // 成功提示1秒后自动消失
  useEffect(() => {
    if (showSuccessMessage) {
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessMessage]);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setUrl(initialData.url);
        setDescription(initialData.description || '');
        setCategoryId(initialData.categoryId);
        setPinned(initialData.pinned || false);
        setIcon(initialData.icon || '');
        setTags(initialData.tags || []);
        setTagInput('');
      } else {
        setTitle('');
        setUrl('');
        setDescription('');
        // 如果有默认分类ID且该分类存在，则使用默认分类，否则使用第一个分类
        const defaultCategory = defaultCategoryId && categories.find(cat => cat.id === defaultCategoryId);
        setCategoryId(defaultCategory ? defaultCategoryId : (categories[0]?.id || 'common'));
        setPinned(false);
        setIcon('');
        setTags([]);
        setTagInput('');
      }
    }
  }, [isOpen, initialData, categories, defaultCategoryId]);

  // 当URL变化且启用自动获取图标时，自动获取图标
  useEffect(() => {
    if (url && autoFetchIcon && !initialData) {
      const timer = setTimeout(() => {
        handleFetchIcon();
      }, 500); // 延迟500ms执行，避免频繁请求
      
      return () => clearTimeout(timer);
    }
  }, [url, autoFetchIcon, initialData]);

  const handleDelete = () => {
    if (!initialData) return;
    onDelete && onDelete(initialData.id);
    onClose();
  };

  const addTags = (value: string) => {
    const candidates = value
      .split(/[,，]/)
      .map(tag => tag.trim().replace(/\s+/g, ' '))
      .filter(Boolean);

    if (candidates.length === 0) return;

    setTags(current => {
      const next = [...current];
      candidates.forEach(candidate => {
        if (candidate.length <= 20 && next.length < 10 && !next.some(tag => tag.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
          next.push(candidate);
        }
      });
      return next;
    });
    setTagInput('');
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      addTags(tagInput);
    } else if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(current => current.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(current => current.filter(tag => tag !== tagToRemove));
  };

  // 缓存自定义图标到KV空间
  const cacheCustomIcon = async (url: string, iconUrl: string) => {
    try {
      // 提取域名
      let domain = url;
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 将自定义图标保存到KV缓存
      const authToken = localStorage.getItem('authToken');
      if (authToken) {
        await fetch('/api/storage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-password': authToken
          },
          body: JSON.stringify({
            saveConfig: 'favicon',
            domain: domain,
            icon: iconUrl
          })
        });
        console.log(`Custom icon cached for domain: ${domain}`);
      }
    } catch (error) {
      console.log("Failed to cache custom icon", error);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !url) return;
    
    // 确保URL有协议前缀
    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }
    
    const pendingTags = tagInput.trim()
      ? [...tags, ...tagInput.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)]
      : tags;
    const normalizedTags = pendingTags.reduce<string[]>((result, tag) => {
      const normalized = tag.replace(/\s+/g, ' ').slice(0, 20);
      if (normalized && result.length < 10 && !result.some(item => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
        result.push(normalized);
      }
      return result;
    }, []);

    // 保存链接数据
    onSave({
      id: initialData?.id || '',
      title,
      url: finalUrl,
      icon,
      description,
      categoryId,
      pinned,
      tags: normalizedTags
    });
    
    // 如果有自定义图标URL，缓存到KV空间
    if (icon && !icon.includes('gstatic.cn')) {
      cacheCustomIcon(finalUrl, icon);
    }
    
    // 批量模式下不关闭窗口，只显示成功提示
    if (batchMode) {
      setShowSuccessMessage(true);
      // 重置表单，但保留分类和批量模式设置
      setTitle('');
      setUrl('');
      setIcon('');
      setDescription('');
      setPinned(false);
      setTags([]);
      setTagInput('');
      // 如果开启自动获取图标，尝试获取新图标
      if (autoFetchIcon && finalUrl) {
        handleFetchIcon();
      }
    } else {
      onClose();
    }
  };

  const handleAIAssist = async () => {
    if (!url || !title) return;
    setIsGenerating(true);
    setAiError('');
    // Parallel execution for speed
    try {
        const descPromise = generateLinkDescription(title, url, aiConfig);
        const catPromise = suggestCategory(title, url, categories, aiConfig);
        
        const [desc, cat] = await Promise.all([descPromise, catPromise]);
        
        if (desc) setDescription(desc);
        if (cat) setCategoryId(cat);
        
    } catch (e) {
        console.error("AI Assist failed", e);
        setAiError(e instanceof Error ? e.message : 'AI 自动填写失败，请检查 AI 设置');
    } finally {
        setIsGenerating(false);
    }
  };

  const handleFetchIcon = async () => {
    if (!url) return;
    
    setIsFetchingIcon(true);
    try {
      // 提取域名
      let domain = url;
      // 如果URL没有协议前缀，添加https://作为默认协议
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        domain = 'https://' + url;
      }
      
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 先尝试从KV缓存获取图标
      try {
        const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.cached && data.icon) {
            setIcon(data.icon);
            setIsFetchingIcon(false);
            return;
          }
        }
      } catch (error) {
        console.log("Failed to fetch cached icon, will generate new one", error);
      }
      
      // 如果缓存中没有，则生成新图标
      const iconUrl = `https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://${domain}`;
      setIcon(iconUrl);
      
      // 将图标保存到KV缓存
      try {
        const authToken = localStorage.getItem('authToken');
        if (authToken) {
          await fetch('/api/storage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-auth-password': authToken
            },
            body: JSON.stringify({
              saveConfig: 'favicon',
              domain: domain,
              icon: iconUrl
            })
          });
        }
      } catch (error) {
        console.log("Failed to cache icon", error);
      }
    } catch (e) {
      console.error("Failed to fetch icon", e);
      alert("无法获取图标，请检查URL是否正确");
    } finally {
      setIsFetchingIcon(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold dark:text-white">
              {initialData ? '编辑链接' : '添加新链接'}
            </h3>
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                pinned 
                ? 'bg-blue-100 border-blue-200 text-blue-600 dark:bg-blue-900/40 dark:border-blue-800 dark:text-blue-300' 
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={pinned ? "取消置顶" : "置顶"}
            >
              <Pin size={14} className={pinned ? "fill-current" : ""} />
              <span className="text-xs font-medium">置顶</span>
            </button>
            {!initialData && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600">
                <input
                  type="checkbox"
                  id="batchMode"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                  className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
                />
                <label htmlFor="batchMode" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                  批量添加不关窗口
                </label>
              </div>
            )}
            {initialData && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                  'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-900/30'
                }`}
                title="删除链接"
              >
                <Trash2 size={14} />
                <span className="text-xs font-medium">删除</span>
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">标题</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="网站名称"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">URL 链接</label>
            <div className="flex gap-2">
                <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="example.com 或 https://..."
                />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">图标 URL</label>
            <div className="flex gap-2">
              {icon && (
                <div className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden flex-shrink-0 bg-white dark:bg-slate-700">
                  <img
                    src={icon}
                    alt="图标预览"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
              <input
                type="url"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="https://example.com/icon.png"
              />
              <button
                type="button"
                onClick={handleFetchIcon}
                disabled={!url || isFetchingIcon}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1 transition-colors"
              >
                {isFetchingIcon ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                获取图标
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="autoFetchIcon"
                checked={autoFetchIcon}
                onChange={(e) => setAutoFetchIcon(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
              />
              <label htmlFor="autoFetchIcon" className="text-sm text-slate-700 dark:text-slate-300">
                自动获取URL链接的图标
              </label>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium dark:text-slate-300">描述 (选填)</label>
                {(title && url) && (
                    <button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={isGenerating}
                        className="text-xs flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                    >
                        {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        AI 自动填写
                    </button>
                )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all h-20 resize-none"
              placeholder="简短描述..."
            />
            {aiError && <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">{aiError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">分类</label>
            <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            >
            {categories.filter(c => !c.parentId).map(parent => (
              <optgroup key={parent.id} label={parent.name}>
                <option value={parent.id}>{parent.name}</option>
                {categories.filter(c => c.parentId === parent.id).map(sub => (
                  <option key={sub.id} value={sub.id}>{parent.name} / {sub.name}</option>
                ))}
              </optgroup>
            ))}
            </select>
          </div>

          <div>
            <label htmlFor="link-tags" className="block text-sm font-medium mb-1 dark:text-slate-300">标签 (选填)</label>
            <div className="min-h-10 flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium">
                  <span className="truncate">{tag}</span>
                  <button type="button" onClick={() => removeTag(tag)} className="shrink-0 rounded-sm hover:bg-blue-100 dark:hover:bg-blue-800" aria-label={`删除标签 ${tag}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1 flex-1 min-w-[120px]">
                <Tag size={14} className="shrink-0 text-slate-400" />
                <input
                  id="link-tags"
                  type="text"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => addTags(tagInput)}
                  disabled={tags.length >= 10}
                  maxLength={60}
                  className="w-full min-w-0 bg-transparent text-sm text-slate-900 dark:text-white outline-none disabled:cursor-not-allowed"
                  placeholder={tags.length >= 10 ? '最多 10 个标签' : '输入后按回车或逗号'}
                />
              </div>
            </div>
            {availableTags.some(tag => !tags.some(current => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) && tags.length < 10 && (
              <div className="flex flex-wrap gap-1.5 mt-2" aria-label="已有标签">
                {availableTags
                  .filter(tag => !tags.some(current => current.toLocaleLowerCase() === tag.toLocaleLowerCase()))
                  .slice(0, 8)
                  .map(tag => (
                    <button key={tag} type="button" onClick={() => addTags(tag)} className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-300 transition-colors">
                      + {tag}
                    </button>
                  ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">每个网站最多 10 个标签，每个标签最多 20 个字符</p>
          </div>

          <div className="pt-2 relative">
            {/* 成功提示 */}
            {showSuccessMessage && (
              <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg transition-opacity duration-300">
                添加成功
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/30"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LinkModal;
