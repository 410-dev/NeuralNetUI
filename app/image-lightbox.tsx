"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalTransition } from "@/lib/use-modal-focus";

// The picture viewer is a dialog like any other, so it takes the shared focus behaviour rather
// than its own key handler: the trap, the inert background and the restored opener all come from
// one place. Opening it from inside another dialog therefore suspends that dialog's trap.
export function ImageLightbox({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}){
  const {ref,close:closeModal,closing}=useModalTransition(onClose);
  // Scrolling is the one thing the shared hook does not own, because only a full-bleed surface
  // needs the page held still underneath it.
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous;};},[]);
  const ko=typeof document!=="undefined"&&document.documentElement.lang.startsWith("ko");
  const close=ko?"닫기":"Close";
  return createPortal(<div ref={ref} tabIndex={-1} className={`image-lightbox ${closing?"modal-closing":""}`} role="dialog" aria-modal="true" aria-label={alt||(ko?"이미지 미리보기":"Image preview")} onClick={()=>closeModal()}><button onClick={()=>closeModal()} aria-label={close} title={close}><X size={25}/></button><img src={src} alt={alt} onClick={event=>event.stopPropagation()}/></div>,document.body);
}
