import {useEffect,useMemo} from "react";
import {ProjectsView,type ProjectsHost} from "@client-kit/platform/react/projects";
import {queryProjects} from "../bff-client";

export function ProjectsPane({scopeKey}:{scopeKey:string}){
  const scope=useMemo(()=>({active:true}),[scopeKey]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const host=useMemo<ProjectsHost>(()=>({scopeKey,query:async request=>{
    if(!scope.active)throw new Error("Project scope changed");
    const page=await queryProjects(request);
    if(!scope.active)throw new Error("Project scope changed");
    return page;
  }}),[scopeKey,scope]);
  return <ProjectsView host={host}/>;
}
