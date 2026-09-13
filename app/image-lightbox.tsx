"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ImageLightbox({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}){
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow="hidden";const key=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};window.addEventListener("keydown",key);return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",key);};},[onClose]);
  return createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt||"Image preview"} onClick={onClose}><button onClick={onClose} aria-label="Close"><X size={25}/></button><img src={src} alt={alt} onClick={event=>event.stopPropagation()}/></div>,document.body);
}
