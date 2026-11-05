import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginView } from "./login";
import { firebaseAuth } from "../lib/firebase.client";
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
vi.mock("../lib/firebase.client",()=>({firebaseAuth:vi.fn()}));
vi.mock("firebase/auth",()=>({GoogleAuthProvider:class {}, createUserWithEmailAndPassword:vi.fn(),sendEmailVerification:vi.fn(),sendPasswordResetEmail:vi.fn(),signInWithEmailAndPassword:vi.fn(),signInWithPopup:vi.fn(),signOut:vi.fn()}));
const config={enabled:true,apiKey:"public",projectId:"demo-test",authDomain:"demo-test.firebaseapp.com",appId:"app",emulatorUrl:""};
const user={emailVerified:false,getIdToken:vi.fn()};
beforeEach(()=>{vi.mocked(firebaseAuth).mockResolvedValue({} as Awaited<ReturnType<typeof firebaseAuth>>);vi.mocked(signInWithEmailAndPassword).mockResolvedValue({user} as never);vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({user} as never);vi.mocked(signInWithPopup).mockResolvedValue({user} as never);});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
function fill() { fireEvent.change(screen.getByLabelText("メールアドレス"),{target:{value:"person@company.example"}});fireEvent.change(screen.getByLabelText("パスワード"),{target:{value:"long-password"}}); }
describe("Firebase login",()=>{
 it("offers both email/password and Google",()=>{render(<LoginView config={config} error=""/>);expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("type","email");expect(screen.getByLabelText("パスワード")).toHaveAttribute("type","password");expect(screen.getByRole("button",{name:"Googleでログイン"})).toBeEnabled();});
 it("accepts non-Google email addresses and sends verification",async()=>{render(<LoginView config={config} error=""/>);fill();fireEvent.click(screen.getByRole("button",{name:"メールアドレスでログイン"}));await waitFor(()=>expect(signInWithEmailAndPassword).toHaveBeenCalledWith({},"person@company.example","long-password"));await waitFor(()=>expect(sendEmailVerification).toHaveBeenCalledWith(user));expect(user.getIdToken).not.toHaveBeenCalled();expect(await screen.findByRole("status")).toHaveTextContent("確認メール");expect(signOut).toHaveBeenCalled();});
 it("registers accounts through Firebase",async()=>{render(<LoginView config={config} error=""/>);fireEvent.click(screen.getByRole("button",{name:"新規登録"}));fill();fireEvent.click(screen.getByRole("button",{name:"アカウント登録"}));await waitFor(()=>expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({},"person@company.example","long-password"));});
 it("uses Firebase Google provider",async()=>{render(<LoginView config={config} error=""/>);fireEvent.click(screen.getByRole("button",{name:"Googleでログイン"}));await waitFor(()=>expect(signInWithPopup).toHaveBeenCalled());});
 it("requests password resets without sending passwords to Go",async()=>{render(<LoginView config={config} error=""/>);fireEvent.click(screen.getByRole("button",{name:"パスワードを忘れた場合"}));fireEvent.change(screen.getByLabelText("メールアドレス"),{target:{value:"person@company.example"}});fireEvent.click(screen.getByRole("button",{name:"再設定メールを送信"}));await waitFor(()=>expect(sendPasswordResetEmail).toHaveBeenCalledWith({},"person@company.example"));expect(await screen.findByRole("status")).toHaveTextContent("再設定");});
 it("hides provider details on failures",async()=>{vi.mocked(signInWithPopup).mockRejectedValueOnce({code:"auth/internal-error",message:"secret-provider-detail"});render(<LoginView config={config} error=""/>);fireEvent.click(screen.getByRole("button",{name:"Googleでログイン"}));expect(await screen.findByRole("alert")).not.toHaveTextContent("secret-provider-detail");expect(signOut).toHaveBeenCalled();});
 it("shows configuration unavailable",()=>{render(<LoginView config={null} error=""/>);expect(screen.getByRole("status")).toHaveTextContent("準備ができていません");expect(screen.queryByRole("button",{name:"Googleでログイン"})).not.toBeInTheDocument();});
});
