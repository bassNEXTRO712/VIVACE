import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Trash2, Film, ImageIcon, Loader2, X } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function MediaGallery({ company, onUpdate }) {
  const fileRef = useRef();
  const [pending, setPending] = useState([]); // {file, preview, type}
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const media = company.media || [];

  const onSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const items = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith("video") ? "video" : "image",
    }));
    setPending((prev) => [...prev, ...items]);
    e.target.value = "";
  };

  const removePending = (idx) =>
    setPending((prev) => prev.filter((_, i) => i !== idx));

  const uploadAll = async () => {
    if (pending.length === 0) return;
    setUploading(true);
    let current = { ...company };
    try {
      for (let i = 0; i < pending.length; i++) {
        const fd = new FormData();
        fd.append("file", pending[i].file);
        const { data } = await api.post(`/company/${company.id}/media`, fd, {
          onUploadProgress: (evt) => {
            const pct = Math.round((evt.loaded * 100) / (evt.total || 1));
            setProgress(pct);
          },
        });
        current = { ...current, media: [...(current.media || []), data] };
        onUpdate(current);
        setProgress(0);
      }
      setPending([]);
      toast.success("მედია ატვირთულია");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/company/${company.id}/media/${id}`);
      onUpdate({ ...company, media: media.filter((m) => m.id !== id) });
      toast.success("წაიშალა");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div className="bg-card border border-border rounded-lg p-6">
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden
          data-testid="media-file-input" onChange={onSelect} />
        <div onClick={() => fileRef.current.click()}
          data-testid="media-upload-zone"
          className="border-2 border-dashed border-border bg-secondary/30 hover:bg-secondary hover:border-primary transition-colors p-8 flex flex-col items-center justify-center text-center cursor-pointer min-h-[160px] rounded-lg">
          <Upload className="w-8 h-8 text-primary mb-3" />
          <p className="font-medium">ატვირთეთ ფოტო ან ვიდეო</p>
          <p className="text-sm text-muted-foreground mt-1">დააჭირეთ ფაილების ასარჩევად</p>
        </div>

        {pending.length > 0 && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {pending.map((p, idx) => (
                <div key={idx} className="relative group rounded-md overflow-hidden border border-border aspect-square bg-secondary">
                  {p.type === "video" ? (
                    <video src={p.preview} className="w-full h-full object-cover" />
                  ) : (
                    <img src={p.preview} alt="preview" className="w-full h-full object-cover" />
                  )}
                  <button onClick={() => removePending(idx)} aria-label="remove"
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
            {uploading && (
              <Progress value={progress} data-testid="upload-progress"
                className="h-2 bg-secondary [&>div]:bg-primary" />
            )}
            <Button data-testid="save-media-button" onClick={uploadAll} disabled={uploading}
              className="bg-primary hover:bg-orange-600 transition-colors">
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> იტვირთება ({progress}%)</>
                : `${pending.length} ფაილის შენახვა`}
            </Button>
          </div>
        )}
      </div>

      {/* Gallery grid */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-medium mb-4">გალერეა ({media.length})</h3>
        {media.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">მედია ფაილები არ არის</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {media.map((m) => (
              <div key={m.id} data-testid="gallery-item"
                className="relative group rounded-md overflow-hidden border border-border aspect-square bg-secondary">
                {m.type === "video" ? (
                  <video src={fileUrl(m.url)} className="w-full h-full object-cover" controls />
                ) : (
                  <img src={fileUrl(m.url)} alt={m.original_filename} className="w-full h-full object-cover" />
                )}
                <div className="absolute top-1 left-1 bg-black/60 rounded px-1.5 py-0.5 flex items-center gap-1">
                  {m.type === "video" ? <Film className="w-3 h-3 text-white" /> : <ImageIcon className="w-3 h-3 text-white" />}
                </div>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button data-testid="delete-media-button" size="icon" variant="destructive" className="h-9 w-9">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card border-border">
                      <AlertDialogHeader>
                        <AlertDialogTitle>წაშლა?</AlertDialogTitle>
                        <AlertDialogDescription>ეს ფაილი სამუდამოდ წაიშლება.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>გაუქმება</AlertDialogCancel>
                        <AlertDialogAction data-testid="confirm-delete-button"
                          onClick={() => remove(m.id)}
                          className="bg-destructive hover:bg-red-700">წაშლა</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
